use std::io::Cursor;

pub fn encode_capture(
    samples: &[f32],
    channels: u16,
    sample_rate: u32,
) -> Result<Vec<u8>, Box<dyn std::error::Error + Send + Sync>> {
    let spec = hound::WavSpec {
        channels,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let mut cursor = Cursor::new(Vec::new());
    {
        let mut writer = hound::WavWriter::new(&mut cursor, spec)?;
        let amplitude = i16::MAX as f32;
        for &sample in samples {
            writer.write_sample((sample * amplitude) as i16)?;
        }
        writer.finalize()?;
    }
    Ok(cursor.into_inner())
}
