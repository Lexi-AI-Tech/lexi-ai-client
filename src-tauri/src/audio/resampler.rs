//! Resample mono f32 audio to 16 kHz (used by the Windows STT pipeline).

use rubato::{
    Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction,
};

pub fn resample_to_16khz(input: &[f32], input_sample_rate: u32) -> Result<Vec<f32>, String> {
    if input_sample_rate == 16_000 {
        return Ok(input.to_vec());
    }

    let resample_ratio = 16_000_f64 / input_sample_rate as f64;

    let params = SincInterpolationParameters {
        sinc_len: 256,
        f_cutoff: 0.95,
        interpolation: SincInterpolationType::Linear,
        oversampling_factor: 256,
        window: WindowFunction::BlackmanHarris2,
    };

    let chunk_size = input.len().max(1);
    let mut resampler = SincFixedIn::<f32>::new(resample_ratio, 2.0, params, chunk_size, 1)
        .map_err(|e| format!("Failed to create resampler: {e:?}"))?;

    let output_frames = resampler.output_frames_max();
    let mut output = vec![0.0f32; output_frames];

    let (_, written) = resampler
        .process_into_buffer(&[input], &mut [&mut output], None)
        .map_err(|e| format!("Resampling failed: {e:?}"))?;

    output.truncate(written);
    Ok(output)
}
