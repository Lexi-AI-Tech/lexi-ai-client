//! STT preprocessing: mono downmix → DC removal → 16 kHz → normalize → gate → PCM16 WAV.

use std::io::Cursor;

use super::resampler::resample_to_16khz;

const STT_SAMPLE_RATE: u32 = 16_000;
const STT_CHANNELS: u16 = 1;
const STT_TARGET_PEAK: f32 = 0.8;
const SILENT_CHANNEL_RMS: f32 = 1e-4;
const NOISE_GATE_THRESHOLD: f32 = 0.003;

pub fn process_for_stt(
    samples: &[f32],
    channels: u16,
    sample_rate: u32,
) -> Result<Vec<u8>, String> {
    if samples.is_empty() {
        return Err("No audio samples to process".to_string());
    }

    let ch = channels.max(1) as usize;
    if samples.len() % ch != 0 {
        return Err(format!(
            "Sample count {} is not divisible by channel count {}",
            samples.len(),
            ch
        ));
    }

    let mut mono = downmix_to_mono(samples, ch);
    remove_dc_offset(&mut mono);
    apply_noise_gate(&mut mono, NOISE_GATE_THRESHOLD);

    let resampled = resample_to_16khz(&mono, sample_rate)?;
    let normalized = peak_normalize(&resampled, STT_TARGET_PEAK);
    encode_pcm16_wav(&normalized, STT_SAMPLE_RATE)
}

fn downmix_to_mono(interleaved: &[f32], channels: usize) -> Vec<f32> {
    if channels <= 1 {
        return interleaved.to_vec();
    }

    let frames = interleaved.len() / channels;
    if frames == 0 {
        return Vec::new();
    }

    let mut sumsq = vec![0.0f32; channels];
    for frame in 0..frames {
        let base = frame * channels;
        for ch in 0..channels {
            let s = interleaved[base + ch];
            sumsq[ch] += s * s;
        }
    }

    let rms: Vec<f32> = sumsq
        .iter()
        .map(|&s| (s / frames as f32).sqrt())
        .collect();

    let mut active: Vec<usize> = rms
        .iter()
        .enumerate()
        .filter(|(_, &e)| e > SILENT_CHANNEL_RMS)
        .map(|(i, _)| i)
        .collect();

    if active.is_empty() {
        active = (0..channels).collect();
    }

    let scale = 1.0 / active.len() as f32;
    let mut mono = Vec::with_capacity(frames);
    for frame in 0..frames {
        let base = frame * channels;
        let sum: f32 = active.iter().map(|&ch| interleaved[base + ch]).sum();
        mono.push((sum * scale).clamp(-1.0, 1.0));
    }
    mono
}

fn remove_dc_offset(samples: &mut [f32]) {
    if samples.is_empty() {
        return;
    }
    let mean = samples.iter().sum::<f32>() / samples.len() as f32;
    if mean.abs() < 1e-8 {
        return;
    }
    for s in samples.iter_mut() {
        *s -= mean;
    }
}

fn apply_noise_gate(samples: &mut [f32], threshold: f32) {
    for s in samples.iter_mut() {
        if s.abs() < threshold {
            *s = 0.0;
        }
    }
}

fn peak_normalize(samples: &[f32], target_peak: f32) -> Vec<f32> {
    let peak = samples.iter().fold(0.0f32, |m, &x| m.max(x.abs()));
    if peak <= 0.0 {
        return samples.to_vec();
    }
    let gain = (target_peak / peak).min(10.0);
    if (gain - 1.0).abs() <= 1e-3 {
        return samples.to_vec();
    }
    samples
        .iter()
        .map(|&x| (x * gain).clamp(-1.0, 1.0))
        .collect()
}

fn encode_pcm16_wav(samples: &[f32], sample_rate: u32) -> Result<Vec<u8>, String> {
    let spec = hound::WavSpec {
        channels: STT_CHANNELS,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let mut cursor = Cursor::new(Vec::new());
    {
        let mut writer =
            hound::WavWriter::new(&mut cursor, spec).map_err(|e| format!("WAV writer: {e}"))?;
        let amplitude = i16::MAX as f32;
        for &sample in samples {
            let s = (sample.clamp(-1.0, 1.0) * amplitude) as i16;
            writer
                .write_sample(s)
                .map_err(|e| format!("WAV sample write: {e}"))?;
        }
        writer
            .finalize()
            .map_err(|e| format!("WAV finalize: {e}"))?;
    }
    Ok(cursor.into_inner())
}
