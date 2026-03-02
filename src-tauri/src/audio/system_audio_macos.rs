//! macOS system audio capture using Core Audio Process Tap API.
//!
//! Creates a virtual aggregate device with a process tap (no BlackHole or loopback driver).
//! Audio is captured via an IO proc and pushed to a ring buffer; a reader thread
//! converts F32 to i16 PCM and sends chunks for mixing with microphone.

#![cfg(target_os = "macos")]

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use cidre::{arc, av, cat, cf, core_audio as ca, ns, os};
use ringbuf::traits::{Consumer, Producer, Split};
use ringbuf::HeapRb;

const RING_BUF_SIZE: usize = 1024 * 128;
const CHUNK_SAMPLES: usize = 1024;

struct AudioContext {
    format: arc::R<av::AudioFormat>,
    producer: ringbuf::HeapProd<f32>,
    current_sample_rate: Arc<std::sync::atomic::AtomicU32>,
}

/// System audio capture: process tap + aggregate device, feeds chunks to a sender.
pub struct SystemAudioCapture {
    _device: ca::hardware::StartedDevice<ca::AggregateDevice>,
    _ctx: Box<AudioContext>,
    _tap: ca::TapGuard,
    should_stop: Arc<AtomicBool>,
    _join: Option<thread::JoinHandle<()>>,
}

extern "C" fn audio_proc(
    device: ca::Device,
    _now: &cat::AudioTimeStamp,
    input_data: &cat::AudioBufList<1>,
    _input_time: &cat::AudioTimeStamp,
    _output_data: &mut cat::AudioBufList<1>,
    _output_time: &cat::AudioTimeStamp,
    ctx: Option<&mut AudioContext>,
) -> os::Status {
    let ctx = match ctx {
        Some(c) => c,
        None => return os::Status::NO_ERR,
    };

    let after = device
        .nominal_sample_rate()
        .unwrap_or(ctx.format.absd().sample_rate) as u32;
    let before = ctx.current_sample_rate.load(Ordering::Acquire);
    if before != after {
        ctx.current_sample_rate.store(after, Ordering::Release);
    }

    if let Some(view) = av::AudioPcmBuf::with_buf_list_no_copy(&ctx.format, input_data, None) {
        if let Some(data) = view.data_f32_at(0) {
            let _ = ctx.producer.push_slice(data);
        }
    } else if ctx.format.common_format() == av::audio::CommonFormat::PcmF32 {
        let first_buffer = &input_data.buffers[0];
        let byte_count = first_buffer.data_bytes_size as usize;
        let float_count = byte_count / std::mem::size_of::<f32>();
        if float_count > 0 && !first_buffer.data.is_null() {
            let data = unsafe {
                std::slice::from_raw_parts(first_buffer.data as *const f32, float_count)
            };
            let _ = ctx.producer.push_slice(data);
        }
    }

    os::Status::NO_ERR
}

fn reader_loop(
    mut consumer: ringbuf::HeapCons<f32>,
    sender: Sender<Vec<u8>>,
    should_stop: Arc<AtomicBool>,
) {
    let mut buffer = Vec::with_capacity(CHUNK_SAMPLES);
    let amplitude = i16::MAX as f32;

    while !should_stop.load(Ordering::Relaxed) {
        buffer.clear();
        while buffer.len() < CHUNK_SAMPLES {
            match consumer.try_pop() {
                Some(s) => buffer.push(s),
                None => break,
            }
        }

        if buffer.is_empty() {
            thread::sleep(Duration::from_millis(1));
            continue;
        }

        let mut bytes = Vec::with_capacity(buffer.len() * 2);
        for &sample in &buffer {
            let val = (sample * amplitude).clamp(i16::MIN as f32, i16::MAX as f32) as i16;
            bytes.extend_from_slice(&val.to_le_bytes());
        }
        if sender.send(bytes).is_err() {
            break;
        }
    }
}

impl SystemAudioCapture {
    /// Create system audio capture and spawn a thread that sends i16 PCM chunks to `sender`.
    /// Stops when `SystemAudioCapture` is dropped or the sender is dropped.
    pub fn new(sender: Sender<Vec<u8>>) -> Result<Self, String> {
        println!("🔊 System audio: Creating process tap (global mono)...");

        let output_device = ca::System::default_output_device().map_err(|e| {
            format!("Failed to get default output device: {:?}", e)
        })?;
        let output_uid = output_device
            .uid()
            .map_err(|e| format!("Failed to get device UID: {:?}", e))?;

        let tap_desc = ca::TapDesc::with_mono_global_tap_excluding_processes(&ns::Array::new());
        let tap = tap_desc.create_process_tap().map_err(|e| {
            format!("Failed to create process tap: {:?}", e)
        })?;

        let sub_tap = cf::DictionaryOf::with_keys_values(
            &[ca::sub_device_keys::uid()],
            &[tap.uid().unwrap().as_type_ref()],
        );

        let agg_desc = cf::DictionaryOf::with_keys_values(
            &[
                ca::aggregate_device_keys::is_private(),
                ca::aggregate_device_keys::is_stacked(),
                ca::aggregate_device_keys::tap_auto_start(),
                ca::aggregate_device_keys::name(),
                ca::aggregate_device_keys::main_sub_device(),
                ca::aggregate_device_keys::uid(),
                ca::aggregate_device_keys::tap_list(),
            ],
            &[
                cf::Boolean::value_true().as_type_ref(),
                cf::Boolean::value_false(),
                cf::Boolean::value_true().as_type_ref(), // tap_auto_start
                cf::str!(c"lexi-audio-tap").as_type_ref(),
                &output_uid,
                &cf::Uuid::new().to_cf_string(),
                &cf::ArrayOf::from_slice(&[sub_tap.as_ref()]),
            ],
        );

        let asbd = tap.asbd().map_err(|e| format!("Failed to get tap ASBD: {:?}", e))?;
        let format = av::AudioFormat::with_asbd(&asbd).ok_or("Failed to create audio format")?;

        let rb = HeapRb::<f32>::new(RING_BUF_SIZE);
        let (producer, consumer) = rb.split();
        let current_sample_rate = Arc::new(std::sync::atomic::AtomicU32::new(asbd.sample_rate as u32));

        let mut ctx = Box::new(AudioContext {
            format,
            producer,
            current_sample_rate: current_sample_rate.clone(),
        });

        let agg_device = ca::AggregateDevice::with_desc(&agg_desc)
            .map_err(|e| format!("Failed to create aggregate device: {:?}", e))?;
        let proc_id = agg_device
            .create_io_proc_id(audio_proc, Some(&mut *ctx))
            .map_err(|e| format!("Failed to create IO proc: {:?}", e))?;
        let started_device = ca::device_start(agg_device, Some(proc_id))
            .map_err(|e| format!("Failed to start device: {:?}", e))?;

        println!(
            "✅ System audio: tap started, {} Hz, {} ch",
            asbd.sample_rate, asbd.channels_per_frame
        );

        let should_stop = Arc::new(AtomicBool::new(false));
        let should_stop_clone = Arc::clone(&should_stop);
        let join = thread::spawn(move || {
            reader_loop(consumer, sender, should_stop_clone);
        });

        Ok(Self {
            _device: started_device,
            _ctx: ctx,
            _tap: tap,
            should_stop,
            _join: Some(join),
        })
    }
}

impl Drop for SystemAudioCapture {
    fn drop(&mut self) {
        self.should_stop.store(true, Ordering::Release);
        if let Some(join) = self._join.take() {
            let _ = join.join();
        }
        println!("🔊 System audio: capture stopped");
    }
}
