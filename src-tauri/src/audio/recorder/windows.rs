use crate::audio::pipeline;

pub fn encode_capture(
    samples: &[f32],
    channels: u16,
    sample_rate: u32,
) -> Result<Vec<u8>, Box<dyn std::error::Error + Send + Sync>> {
    pipeline::process_for_stt(samples, channels, sample_rate).map_err(Into::into)
}
