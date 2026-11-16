use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashMap, fs, io::{Read, Seek, SeekFrom}, path::{Path, PathBuf}, sync::Mutex, time::{Duration, Instant, UNIX_EPOCH}};

// Bump this when the derived summary's shape or meaning changes.
const CACHE_VERSION: u32 = 2;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct Stamp { bytes: u64, seconds: u64, nanos: u32 }

fn stamp(path: &Path) -> Option<Stamp> {
    let metadata = fs::metadata(path).ok()?;
    let modified = metadata.modified().ok()?.duration_since(UNIX_EPOCH).ok()?;
    Some(Stamp { bytes: metadata.len(), seconds: modified.as_secs(), nanos: modified.subsec_nanos() })
}

fn stable_json(path: &Path) -> Option<(Stamp, Value)> {
    // Do not associate data read before an atomic replacement with its new stamp.
    for _ in 0..2 {
        let before = stamp(path)?;
        let text = fs::read_to_string(path).ok()?;
        let value = serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()?;
        if stamp(path).as_ref() == Some(&before) { return Some((before, value)); }
    }
    None
}

#[derive(Clone, Serialize, Deserialize)]
pub struct ManifestSummary {
    pub total_messages: u64,
    pub folder_count: usize,
    pub local_stats: Value,
}

#[derive(Serialize, Deserialize)]
struct DiskSummary { version: u32, source: PathBuf, stamp: Stamp, summary: ManifestSummary }

#[derive(Default)]
pub struct DashboardCache(pub Mutex<Cache>);

#[derive(Default)]
pub struct Cache {
    files: HashMap<PathBuf, (Stamp, Value)>,
    manifests: HashMap<PathBuf, (Stamp, ManifestSummary)>,
    schedules: HashMap<PathBuf, (Instant, bool)>,
    tails: HashMap<PathBuf, (Stamp, String)>,
}

impl Cache {
    pub fn log_tail(&mut self, path: &Path, force: bool) -> Option<String> {
        let current = stamp(path)?;
        if !force {
            if let Some((saved, tail)) = self.tails.get(path) {
                if saved == &current { return Some(tail.clone()); }
            }
        }
        let mut file = fs::File::open(path).ok()?;
        file.seek(SeekFrom::Start(current.bytes.saturating_sub(64 * 1024))).ok()?;
        let mut bytes = Vec::new();
        file.take(64 * 1024).read_to_end(&mut bytes).ok()?;
        let text = String::from_utf8_lossy(&bytes);
        let tail = text.lines().rev().take(120).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n");
        if stamp(path).as_ref() == Some(&current) { self.tails.insert(path.to_owned(), (current, tail.clone())); }
        Some(tail)
    }

    pub fn json(&mut self, path: &Path, force: bool) -> Option<Value> {
        self.project(path, force, |value| value)
    }

    pub fn project(&mut self, path: &Path, force: bool, project: impl FnOnce(Value) -> Value) -> Option<Value> {
        let current = stamp(path);
        if !force {
            if let Some((saved, value)) = self.files.get(path) {
                if current.as_ref() == Some(saved) { return Some(value.clone()); }
            }
        }
        self.files.remove(path);
        let (saved, value) = stable_json(path)?;
        let value = project(value);
        self.files.insert(path.to_owned(), (saved, value.clone()));
        Some(value)
    }

    pub fn manifest(&mut self, account: &Path, path: &Path, force: bool,
        calculate: impl FnOnce(&Value) -> ManifestSummary) -> Option<ManifestSummary> {
        let current = match stamp(path) {
            Some(current) => current,
            None => { self.manifests.remove(path); return None; }
        };
        let disk_path = account.join(".cache/dashboard-summary.json");
        if !force {
            if let Some((saved, summary)) = self.manifests.get(path) {
                if saved == &current { return Some(summary.clone()); }
            }
            if let Ok(bytes) = fs::read(&disk_path) {
                if let Ok(saved) = serde_json::from_slice::<DiskSummary>(&bytes) {
                    if saved.version == CACHE_VERSION && saved.source == path && saved.stamp == current {
                        self.manifests.insert(path.to_owned(), (current, saved.summary.clone()));
                        return Some(saved.summary);
                    }
                }
            }
        }
        self.manifests.remove(path);
        let (saved, value) = stable_json(path)?;
        let summary = calculate(&value);
        self.manifests.insert(path.to_owned(), (saved.clone(), summary.clone()));
        // Derived data only: cache write failures must never prevent backups or
        // dashboard reads. The manifest remains the source of truth.
        let stored = DiskSummary { version: CACHE_VERSION, source: path.to_owned(), stamp: saved, summary: summary.clone() };
        if let Ok(bytes) = serde_json::to_vec(&stored) {
            if fs::create_dir_all(account.join(".cache")).is_ok() {
                let temporary = account.join(format!(".cache/dashboard-summary.{}.pending", std::process::id()));
                if fs::write(&temporary, bytes).is_ok() {
                    if fs::rename(&temporary, &disk_path).is_err() { let _ = fs::remove_file(&temporary); }
                }
            }
        }
        Some(summary)
    }

    pub fn schedule(&mut self, account: &Path, force: bool, load: impl FnOnce() -> bool) -> bool {
        if !force {
            if let Some((checked, value)) = self.schedules.get(account) {
                if checked.elapsed() < Duration::from_secs(60) { return *value; }
            }
        }
        let value = load();
        self.schedules.insert(account.to_owned(), (Instant::now(), value));
        value
    }

    pub fn invalidate_schedule(&mut self, account: &Path) { self.schedules.remove(account); }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("bmail-cache-{}-{}", std::process::id(), COUNTER.fetch_add(1, Ordering::Relaxed)));
            fs::create_dir_all(&root).unwrap(); Self(root)
        }
    }
    impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
    fn summarize(value: &Value) -> ManifestSummary {
        ManifestSummary { total_messages: value["count"].as_u64().unwrap(), folder_count: 1, local_stats: value.clone() }
    }

    #[test]
    fn account_summaries_reuse_memory_and_disk_and_invalidate_changed_sources() {
        let root = Fixture::new();
        let first = root.0.join("first"); let second = root.0.join("second");
        fs::create_dir_all(&first).unwrap(); fs::create_dir_all(&second).unwrap();
        let a = first.join("manifest.json"); let b = second.join("manifest.json");
        fs::write(&a, r#"{"count":1}"#).unwrap(); fs::write(&b, r#"{"count":99}"#).unwrap();
        let mut cache = Cache::default();
        assert_eq!(cache.manifest(&first, &a, false, summarize).unwrap().total_messages, 1);
        assert_eq!(cache.manifest(&first, &a, false, |_| panic!("memory hit must not aggregate again")).unwrap().total_messages, 1);
        assert_eq!(cache.manifest(&second, &b, false, summarize).unwrap().total_messages, 99);
        let mut restarted = Cache::default();
        assert_eq!(restarted.manifest(&first, &a, false, |_| panic!("disk hit must not parse the manifest")).unwrap().total_messages, 1);
        fs::write(&a, r#"{"count":123}"#).unwrap();
        assert_eq!(cache.manifest(&first, &a, false, summarize).unwrap().total_messages, 123);
        let mut recalculated = false;
        cache.manifest(&first, &a, true, |value| { recalculated = true; summarize(value) });
        assert!(recalculated);
        fs::remove_file(&a).unwrap();
        assert!(cache.manifest(&first, &a, false, summarize).is_none());
    }

    #[test]
    fn corrupt_cache_or_manifest_does_not_return_stale_results() {
        let root = Fixture::new(); let manifest = root.0.join("manifest.json");
        fs::write(&manifest, r#"{"count":5}"#).unwrap();
        Cache::default().manifest(&root.0, &manifest, false, summarize);
        fs::write(root.0.join(".cache/dashboard-summary.json"), "broken cache").unwrap();
        assert_eq!(Cache::default().manifest(&root.0, &manifest, false, summarize).unwrap().total_messages, 5);
        fs::write(&manifest, "broken manifest").unwrap();
        assert!(Cache::default().manifest(&root.0, &manifest, false, summarize).is_none());
    }

    #[test]
    fn projected_files_and_schedules_are_cached_and_can_be_forced_or_invalidated() {
        let root = Fixture::new(); let path = root.0.join("status.json");
        fs::write(&path, r#"{"count":1,"uids":[1,2,3]}"#).unwrap();
        let mut cache = Cache::default();
        let projected = cache.project(&path, false, |mut value| { value.as_object_mut().unwrap().remove("uids"); value }).unwrap();
        assert!(projected.get("uids").is_none());
        assert_eq!(cache.project(&path, false, |_| panic!("cached projection")), Some(projected));
        fs::write(&path, r#"{"count":100}"#).unwrap();
        assert_eq!(cache.json(&path, false).unwrap()["count"], 100);
        assert!(cache.schedule(&root.0, false, || true));
        assert!(cache.schedule(&root.0, false, || panic!("no Windows process on cache hit")));
        assert!(!cache.schedule(&root.0, true, || false));
        cache.invalidate_schedule(&root.0);
        assert!(cache.schedule(&root.0, false, || true));
        cache.schedules.get_mut(&root.0).unwrap().0 = Instant::now() - Duration::from_secs(61);
        assert!(!cache.schedule(&root.0, false, || false));
    }

    #[test]
    fn unwritable_cache_directory_is_optional_and_log_reads_are_bounded() {
        let root = Fixture::new(); let manifest = root.0.join("manifest.json");
        fs::write(&manifest, r#"{"count":7}"#).unwrap();
        fs::write(root.0.join(".cache"), "this is a file, not a directory").unwrap();
        let mut cache = Cache::default();
        assert_eq!(cache.manifest(&root.0, &manifest, false, summarize).unwrap().total_messages, 7);
        let log = root.0.join("large.log");
        let mut content = "old line\n".repeat(20000);
        content.push_str("latest diagnostic\n"); fs::write(&log, content).unwrap();
        let tail = cache.log_tail(&log, false).unwrap();
        assert!(tail.ends_with("latest diagnostic"));
        assert!(tail.lines().count() <= 120);
        assert!(tail.len() <= 64 * 1024);
        assert_eq!(cache.log_tail(&log, false).unwrap(), tail);
    }
}
