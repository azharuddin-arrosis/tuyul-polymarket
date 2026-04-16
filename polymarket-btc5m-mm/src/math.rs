pub fn clamp(x: f64, lo: f64, hi: f64) -> f64 {
    if x < lo {
        lo
    } else if x > hi {
        hi
    } else {
        x
    }
}

pub fn round_to_tick(x: f64, tick: f64) -> f64 {
    if tick <= 0.0 {
        return x;
    }
    (x / tick).round() * tick
}

