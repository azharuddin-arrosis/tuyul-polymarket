use chrono::{DateTime, Utc};

#[derive(Clone, Debug)]
pub struct WindowMeta {
    pub slug: String,
    #[allow(dead_code)]
    pub condition_id: String,
    pub token_up: String,
    pub token_down: String,
    pub end_time: DateTime<Utc>,
    pub tick_size: f64,
    /// Dipakai untuk model fair-value yang lebih advance; kadang tidak tersedia di Gamma.
    #[allow(dead_code)]
    pub price_to_beat: Option<f64>,
}

pub fn window_start_epoch(now: DateTime<Utc>, step_secs: i64) -> i64 {
    let ts = now.timestamp();
    ts - (ts % step_secs)
}
