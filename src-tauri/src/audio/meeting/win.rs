//! Windows meeting system audio: WASAPI loopback on the default render device → 16-bit LE PCM.

use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use windows::Win32::Media::Audio::{
    eConsole, eRender, IAudioCaptureClient, IAudioClient, IMMDeviceEnumerator, MMDeviceEnumerator,
    AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK,
    WAVEFORMATEX, WAVEFORMATEXTENSIBLE,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED,
};

const KSDATAFORMAT_SUBTYPE_IEEE_FLOAT: windows::core::GUID =
    windows::core::GUID::from_u128(0x00000003_0000_0010_8000_00aa00389b71);

const WAVE_FORMAT_PCM: u16 = 1;
const WAVE_FORMAT_IEEE_FLOAT: u16 = 3;
const WAVE_FORMAT_EXTENSIBLE: u16 = 0xFFFE;

struct ParsedFormat {
    channels: u16,
    block_align: u16,
    is_float: bool,
    is_pcm16: bool,
}

unsafe fn parse_mix_format(wf: *const WAVEFORMATEX) -> Option<ParsedFormat> {
    if wf.is_null() {
        return None;
    }
    let w = &*wf;
    let tag = w.wFormatTag;
    let mut is_float = false;
    if tag == WAVE_FORMAT_IEEE_FLOAT {
        is_float = true;
    } else if tag == WAVE_FORMAT_EXTENSIBLE && w.cbSize >= 22 {
        let off = std::mem::offset_of!(WAVEFORMATEXTENSIBLE, SubFormat);
        let sub =
            std::ptr::read_unaligned((wf as *const u8).add(off) as *const windows::core::GUID);
        if sub == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT {
            is_float = true;
        }
    }
    let is_pcm16 = tag == WAVE_FORMAT_PCM && w.wBitsPerSample == 16;
    Some(ParsedFormat {
        channels: w.nChannels,
        block_align: w.nBlockAlign,
        is_float,
        is_pcm16,
    })
}

fn f32_interleaved_to_i16_le(samples: &[f32]) -> Vec<u8> {
    let amp = i16::MAX as f32;
    let mut out = Vec::with_capacity(samples.len() * 2);
    for &s in samples {
        let v = (s * amp).clamp(i16::MIN as f32, i16::MAX as f32) as i16;
        out.extend_from_slice(&v.to_le_bytes());
    }
    out
}

unsafe fn frames_to_pcm_bytes(
    fmt: &ParsedFormat,
    data_ptr: *const u8,
    num_frames: u32,
    flags: u32,
) -> Vec<u8> {
    let frames = num_frames as usize;
    let ch = fmt.channels as usize;
    let byte_len = frames.checked_mul(fmt.block_align as usize).unwrap_or(0);
    if byte_len == 0 {
        return Vec::new();
    }

    let silent = (flags as i32 & AUDCLNT_BUFFERFLAGS_SILENT.0) != 0;
    if silent {
        return vec![0u8; frames * ch * 2];
    }

    let slice = std::slice::from_raw_parts(data_ptr, byte_len);

    if fmt.is_float {
        let n_samples = byte_len / 4;
        let f32s = std::slice::from_raw_parts(data_ptr as *const f32, n_samples);
        return f32_interleaved_to_i16_le(f32s);
    }

    if fmt.is_pcm16 {
        return slice.to_vec();
    }

    if fmt.block_align == (4 * ch as u16) {
        let n_samples = byte_len / 4;
        let f32s = std::slice::from_raw_parts(data_ptr as *const f32, n_samples);
        return f32_interleaved_to_i16_le(f32s);
    }

    eprintln!(
        "[meeting] loopback: unsupported wave format (float={}, pcm16={}, block_align={})",
        fmt.is_float, fmt.is_pcm16, fmt.block_align
    );
    vec![0u8; frames * ch * 2]
}

unsafe fn run_loopback_inner(
    sender: mpsc::Sender<Vec<u8>>,
    stop_rx: &mpsc::Receiver<()>,
) -> Result<(), String> {
    let enumerator: IMMDeviceEnumerator =
        CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|e| format!("{e:?}"))?;

    let device = enumerator
        .GetDefaultAudioEndpoint(eRender, eConsole)
        .map_err(|e| format!("GetDefaultAudioEndpoint(render): {e:?}"))?;

    let audio_client: IAudioClient = device
        .Activate(CLSCTX_ALL, None)
        .map_err(|e| format!("Activate(IAudioClient): {e:?}"))?;

    let mix_format = audio_client
        .GetMixFormat()
        .map_err(|e| format!("GetMixFormat: {e:?}"))?;
    if mix_format.is_null() {
        return Err("GetMixFormat returned null".into());
    }

    let fmt_info = parse_mix_format(mix_format).ok_or_else(|| "invalid mix format".to_string())?;

    let mut buffer_duration: i64 = 200_000; // 20 ms in 100-ns units
    let mut default_period = 0i64;
    let mut min_period = 0i64;
    if audio_client
        .GetDevicePeriod(Some(&mut default_period), Some(&mut min_period))
        .is_ok()
        && default_period > 0
    {
        buffer_duration = default_period.max(200_000);
    }

    audio_client
        .Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_LOOPBACK,
            buffer_duration,
            0,
            mix_format,
            None,
        )
        .map_err(|e| {
            CoTaskMemFree(Some(mix_format as *const _));
            format!("IAudioClient::Initialize(loopback): {e:?}")
        })?;

    let capture_client: IAudioCaptureClient = audio_client.GetService().map_err(|e| {
        CoTaskMemFree(Some(mix_format as *const _));
        format!("GetService(IAudioCaptureClient): {e:?}")
    })?;

    CoTaskMemFree(Some(mix_format as *const _));

    audio_client
        .Start()
        .map_err(|e| format!("IAudioClient::Start: {e:?}"))?;

    loop {
        if stop_rx.try_recv().is_ok() {
            break;
        }

        let packet = match capture_client.GetNextPacketSize() {
            Ok(p) => p,
            Err(_) => {
                thread::sleep(Duration::from_millis(5));
                continue;
            }
        };
        if packet == 0 {
            thread::sleep(Duration::from_millis(3));
            continue;
        }

        let mut data_ptr: *mut u8 = std::ptr::null_mut();
        let mut num_frames = 0u32;
        let mut flags = 0u32;
        if capture_client
            .GetBuffer(&mut data_ptr, &mut num_frames, &mut flags, None, None)
            .is_err()
        {
            thread::sleep(Duration::from_millis(2));
            continue;
        }

        if num_frames == 0 {
            let _ = capture_client.ReleaseBuffer(0);
            continue;
        }

        let pcm = frames_to_pcm_bytes(&fmt_info, data_ptr, num_frames, flags);
        let _ = capture_client.ReleaseBuffer(num_frames);

        if !pcm.is_empty() && sender.send(pcm).is_err() {
            break;
        }
    }

    let _ = audio_client.Stop();
    let _ = audio_client.Reset();
    Ok(())
}

pub(super) fn run_system_audio_capture(sender: mpsc::Sender<Vec<u8>>, stop_rx: mpsc::Receiver<()>) {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        if let Err(e) = run_loopback_inner(sender, &stop_rx) {
            eprintln!("Windows system audio (loopback): {}", e);
        }
    }
}
