//! Mirror of `hyperlane-sealevel-token::accounts::convert_decimals` and the
//! `remote_amount_to_local_amount` u64 conversion (hyperlane-monorepo@a9b3e870,
//! rust/sealevel/libraries/hyperlane-sealevel-token/src/accounts.rs L226).
//! Upstream uses U256; u128 is sufficient for VMPX (cap 1.08624e26 < 3.4e38).
//! This crate exists to prove the arithmetic for OUR parameters
//! (local 9, remote 18) without network access. It is not deployed.

pub const LOCAL_DECIMALS: u8 = 9;
pub const REMOTE_DECIMALS: u8 = 18;
pub const CAP_REMOTE: u128 = 108_624_000u128 * 10u128.pow(18);

pub fn convert_decimals(amount: u128, from: u8, to: u8) -> Option<u128> {
    use std::cmp::Ordering::*;
    match from.cmp(&to) {
        Greater => 10u128.checked_pow((from - to) as u32).and_then(|d| amount.checked_div(d)),
        Less => 10u128.checked_pow((to - from) as u32).and_then(|m| amount.checked_mul(m)),
        Equal => Some(amount),
    }
}

/// inbound on X1: remote (18) -> local (9), then u64
pub fn remote_to_local(amount: u128) -> Option<u64> {
    convert_decimals(amount, REMOTE_DECIMALS, LOCAL_DECIMALS).and_then(|a| u64::try_from(a).ok())
}

/// outbound from X1: local (9) -> remote (18)
pub fn local_to_remote(amount: u64) -> Option<u128> {
    convert_decimals(amount as u128, LOCAL_DECIMALS, REMOTE_DECIMALS)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn whole_cap_fits_u64_at_9_decimals() {
        let local = remote_to_local(CAP_REMOTE).expect("fits");
        assert_eq!(local, 108_624_000u64 * 1_000_000_000);
        assert!(local < u64::MAX);
    }

    #[test]
    fn eighteen_decimals_on_svm_would_overflow() {
        assert!(u64::try_from(CAP_REMOTE).is_err());
    }

    #[test]
    fn upstream_truncates_dust_silently() {
        // This is WHY the EVM lockbox rejects amounts not divisible by 1e9:
        // upstream would mint 1 unit for 1.999999999e9 base units and strand the rest.
        assert_eq!(remote_to_local(1_999_999_999), Some(1));
        assert_eq!(remote_to_local(999_999_999), Some(0));
    }

    #[test]
    fn multiples_of_1e9_roundtrip_exactly() {
        for units in [1u64, 7, 1_000_000_000, 108_624_000 * 1_000_000_000] {
            let remote = local_to_remote(units).unwrap();
            assert_eq!(remote % 1_000_000_000, 0);
            assert_eq!(remote_to_local(remote), Some(units));
        }
    }

    #[test]
    fn exhaustive_sample_roundtrip() {
        // deterministic pseudo-random sample (no external crates)
        let mut x: u64 = 0x9E3779B97F4A7C15;
        for _ in 0..200_000 {
            x ^= x << 13; x ^= x >> 7; x ^= x << 17;
            let units = x % (108_624_000 * 1_000_000_000 + 1);
            assert_eq!(remote_to_local(local_to_remote(units).unwrap()), Some(units));
        }
    }

    #[test]
    fn u64_max_local_does_not_overflow_remote_u128() {
        assert!(local_to_remote(u64::MAX).is_some());
    }
}
