use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Serialize)]
pub struct NotebookError {
    pub error: String,
    pub kind: String,
}

fn error_json(kind: &str, message: &str) -> String {
    serde_json::to_string(&json!({
        "error": message,
        "kind": kind
    }))
    .unwrap_or_else(|e| format!("{{\"error\":\"{}\"}}", e))
}

fn sanitize_id(input: &str) -> String {
    input
        .to_lowercase()
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

#[wasm_bindgen]
pub fn generate_jupyter_notebook(var_name: &str, pkl_path: &str, venv_name: &str) -> String {
    if var_name.trim().is_empty() {
        return error_json("EmptyVarName", "Variable name cannot be empty");
    }
    if pkl_path.trim().is_empty() {
        return error_json("EmptyPklPath", "Pickle path cannot be empty");
    }
    if venv_name.trim().is_empty() {
        return error_json("EmptyVenvName", "Venv name cannot be empty");
    }

    let escaped_pkl_path = pkl_path.replace('\\', "/").replace('\'', "\\'");

    let kernel_name = format!("python3_{}", sanitize_id(venv_name));
    let display_name = format!("Python 3 ({})", venv_name);

    let notebook = json!({
        "nbformat": 4,
        "nbformat_minor": 5,
        "metadata": {
            "kernelspec": {
                "display_name": display_name,
                "name": kernel_name
            },
            "language_info": {
                "name": "python",
                "codemirror_mode": {
                    "name": "ipython",
                    "version": 3
                },
                "file_extension": ".py",
                "mimetype": "text/x-python",
                "pygments_lexer": "python3"
            }
        },
        "cells": [
            {
                "cell_type": "markdown",
                "id": "d2j-header",
                "metadata": {},
                "source": [
                    "# Debug to Jupyter Export\n",
                    "\n",
                    format!("Variable: `{}`\n", var_name)
                ]
            },
            {
                "cell_type": "code",
                "execution_count": null,
                "id": "d2j-load",
                "metadata": {},
                "outputs": [],
                "source": [
                    "import cloudpickle\n",
                    format!("with open('{}', 'rb') as f:\n", escaped_pkl_path),
                    format!("    {} = cloudpickle.load(f)\n", var_name),
                    format!("print(f'Successfully loaded live variable: {}')\n", var_name)
                ]
            }
        ]
    });

    serde_json::to_string_pretty(&notebook)
        .unwrap_or_else(|e| error_json("SerializationFailed", &format!("Failed to serialize notebook: {}", e)))
}

#[derive(Deserialize, Clone)]
pub struct SourceInfo {
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub source_reference: Option<i64>,
}

#[derive(Deserialize, Clone)]
pub struct ThreadFrameCandidate {
    pub thread_id: i64,
    #[serde(default)]
    pub thread_name: String,
    pub frame_id: i64,
    #[serde(default)]
    pub frame_name: String,
    #[serde(default)]
    pub source_path: Option<String>,
    #[serde(default)]
    pub source_name: Option<String>,
    #[serde(default)]
    pub source_ref: Option<i64>,
    #[serde(default)]
    pub line: Option<i64>,
    #[serde(default)]
    pub has_variable: Option<bool>,
}

#[derive(Serialize, Deserialize)]
pub struct RankedFrame {
    pub thread_id: i64,
    pub thread_name: String,
    pub frame_id: i64,
    pub source_path: Option<String>,
    pub line: Option<i64>,
    pub score: i64,
}

fn is_virtual_source(source: &SourceInfo) -> bool {
    if source.source_reference.unwrap_or(0) > 0 {
        return true;
    }
    if let Some(ref p) = source.path {
        if p == "<string>" || p == "<stdin>" || p == "<repl>" {
            return true;
        }
    }
    false
}

fn source_priority(source_path: &Option<String>, workspace_root: &str) -> i64 {
    match source_path {
        None => 3,
        Some(p) => {
            if p.starts_with(workspace_root) {
                0
            } else if p.contains("site-packages") {
                1
            } else {
                2
            }
        }
    }
}

fn is_daemon_thread(name: &str) -> bool {
    let lower = name.to_lowercase();
    const DAEMON_NAMES: &[&str] = &[
        "thread-",
        "greenlet",
        "worker",
        "pool",
        "gc",
        "finalizer",
        "reference",
        "monitor",
        "watchdog",
        "timer",
        "asyncio",
    ];
    DAEMON_NAMES.iter().any(|d| lower.contains(d))
}

fn compute_score(candidate: &ThreadFrameCandidate, workspace_root: &str) -> i64 {
    let mut score: i64 = 0;

    let src = SourceInfo {
        path: candidate.source_path.clone(),
        name: candidate.source_name.clone(),
        source_reference: candidate.source_ref,
    };

    if is_virtual_source(&src) {
        score += 1000;
    }

    score += source_priority(&candidate.source_path, workspace_root) * 100;

    if candidate.has_variable == Some(true) {
        score -= 500;
    }

    let name_lower = candidate.thread_name.to_lowercase();
    if name_lower.contains("main") {
        score -= 50;
    }
    if is_daemon_thread(&candidate.thread_name) {
        score += 200;
    }

    score += candidate.thread_id;

    score
}

#[wasm_bindgen]
pub fn rank_thread_candidates(candidates_json: &str, workspace_root: &str) -> String {
    let candidates: Vec<ThreadFrameCandidate> = match serde_json::from_str(candidates_json) {
        Ok(c) => c,
        Err(e) => return error_json("ParseError", &format!("Failed to parse candidates JSON: {}", e)),
    };

    if candidates.is_empty() {
        return error_json("NoCandidates", "No thread candidates provided");
    }

    let mut ranked: Vec<RankedFrame> = candidates
        .iter()
        .map(|c| {
            let score = compute_score(c, workspace_root);
            RankedFrame {
                thread_id: c.thread_id,
                thread_name: c.thread_name.clone(),
                frame_id: c.frame_id,
                source_path: c.source_path.clone(),
                line: c.line,
                score,
            }
        })
        .collect();

    ranked.sort_by_key(|r| r.score);

    serde_json::to_string(&ranked).unwrap_or_else(|e| error_json("SerializationFailed", &format!("Failed to serialize ranked frames: {}", e)))
}

#[wasm_bindgen]
pub fn is_virtual_source_wasm(source_json: &str) -> String {
    let source: SourceInfo = match serde_json::from_str(source_json) {
        Ok(s) => s,
        Err(e) => return error_json("ParseError", &format!("Failed to parse source JSON: {}", e)),
    };
    json!({ "isVirtual": is_virtual_source(&source) }).to_string()
}

#[wasm_bindgen]
pub fn sanitize_source_path_fn(source_path: &str, workspace_root: &str) -> String {
    let normalized_source = source_path.replace('\\', "/");
    let normalized_root = workspace_root.replace('\\', "/");

    let relative = if normalized_source.starts_with(&normalized_root) {
        &normalized_source[normalized_root.len()..]
    } else {
        ""
    };

    let relative = relative.trim_start_matches('/');

    let result = if relative.is_empty() || relative.starts_with("..") {
        normalized_source
            .split('/')
            .last()
            .unwrap_or("unknown")
            .to_string()
    } else {
        relative.replace('/', "_").replace('\\', "_")
    };

    let result = if let Some(pos) = result.rfind('.') {
        result[..pos].to_string()
    } else {
        result
    };

    result
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '_' || c == '.' || c == '-' { c } else { '_' })
        .collect()
}

#[wasm_bindgen]
pub fn format_timestamp_fn() -> String {
    let date = js_sys::Date::new_0();
    let y = date.get_full_year();
    let mo = date.get_month() + 1;
    let d = date.get_date();
    let h = date.get_hours();
    let mi = date.get_minutes();
    let s = date.get_seconds();
    format!(
        "{:04}{:02}{:02}{:02}{:02}{:02}",
        y, mo, d, h, mi, s
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn test_generate_notebook_basic() {
        let result = generate_jupyter_notebook("my_var", "/tmp/my_var.pkl", "myenv");
        let parsed: Value = serde_json::from_str(&result).expect("Should be valid JSON");
        assert_eq!(parsed["nbformat"], 4);
        assert_eq!(parsed["nbformat_minor"], 5);
        assert_eq!(parsed["metadata"]["kernelspec"]["name"], "python3_myenv");
        assert_eq!(parsed["cells"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn test_empty_var_name_returns_error() {
        let result = generate_jupyter_notebook("", "/tmp/x.pkl", "env");
        let parsed: Value = serde_json::from_str(&result).expect("Should be valid JSON");
        assert!(parsed.get("error").is_some());
    }

    #[test]
    fn test_empty_pkl_path_returns_error() {
        let result = generate_jupyter_notebook("x", "", "env");
        let parsed: Value = serde_json::from_str(&result).expect("Should be valid JSON");
        assert!(parsed.get("error").is_some());
    }

    #[test]
    fn test_empty_venv_name_returns_error() {
        let result = generate_jupyter_notebook("x", "/x.pkl", "");
        let parsed: Value = serde_json::from_str(&result).expect("Should be valid JSON");
        assert!(parsed.get("error").is_some());
    }

    #[test]
    fn test_windows_path_normalization() {
        let result = generate_jupyter_notebook("df", "C:\\Users\\test\\df.pkl", "myenv");
        let parsed: Value = serde_json::from_str(&result).expect("Should be valid JSON");
        let source = parsed["cells"][1]["source"].as_array().unwrap();
        let load_line = source[1].as_str().unwrap();
        assert!(!load_line.contains("\\\\"), "Path should use forward slashes: {}", load_line);
    }

    #[test]
    fn test_sanitize_id() {
        assert_eq!(sanitize_id("My VEnv"), "my-venv");
        assert_eq!(sanitize_id("simple"), "simple");
        assert_eq!(sanitize_id("a!@#b"), "a---b");
    }

    #[test]
    fn test_kernel_name_format() {
        let result = generate_jupyter_notebook("x", "/x.pkl", "data-science");
        let parsed: Value = serde_json::from_str(&result).expect("Should be valid JSON");
        assert_eq!(parsed["metadata"]["kernelspec"]["name"], "python3_data-science");
        assert_eq!(parsed["metadata"]["kernelspec"]["display_name"], "Python 3 (data-science)");
    }

    #[test]
    fn test_single_quotes_in_path() {
        let result = generate_jupyter_notebook("x", "/tmp/my file's data/x.pkl", "env");
        let parsed: Value = serde_json::from_str(&result).expect("Should be valid JSON");
        let source = parsed["cells"][1]["source"].as_array().unwrap();
        let load_line = source[1].as_str().unwrap();
        assert!(load_line.contains("\\'"), "Single quote should be escaped: {}", load_line);
    }

    #[test]
    fn test_is_virtual_source() {
        assert!(is_virtual_source(&SourceInfo { path: Some("<string>".into()), name: None, source_reference: None }));
        assert!(is_virtual_source(&SourceInfo { path: Some("<stdin>".into()), name: None, source_reference: None }));
        assert!(is_virtual_source(&SourceInfo { path: Some("<repl>".into()), name: None, source_reference: None }));
        assert!(is_virtual_source(&SourceInfo { path: None, name: None, source_reference: Some(1) }));
        assert!(!is_virtual_source(&SourceInfo { path: Some("/home/user/main.py".into()), name: None, source_reference: None }));
        assert!(!is_virtual_source(&SourceInfo { path: None, name: None, source_reference: None }));
    }

    #[test]
    fn test_source_priority() {
        assert_eq!(source_priority(&Some("/home/user/project/main.py".into()), "/home/user/project"), 0);
        assert_eq!(source_priority(&Some("/usr/lib/python3/site-packages/foo.py".into()), "/home/user/project"), 1);
        assert_eq!(source_priority(&Some("/tmp/other.py".into()), "/home/user/project"), 2);
        assert_eq!(source_priority(&None, "/home/user/project"), 3);
    }

    #[test]
    fn test_is_daemon_thread() {
        assert!(is_daemon_thread("Thread-3"));
        assert!(is_daemon_thread("greenlet-0"));
        assert!(is_daemon_thread("worker-pool-1"));
        assert!(is_daemon_thread("asyncio-task"));
        assert!(!is_daemon_thread("MainThread"));
        assert!(!is_daemon_thread("my-thread"));
    }

    #[test]
    fn test_rank_thread_candidates_main_preferred() {
        let candidates = json!([
            { "thread_id": 2, "thread_name": "Thread-3", "frame_id": 20, "source_path": "/home/user/project/worker.py", "line": 10 },
            { "thread_id": 1, "thread_name": "MainThread", "frame_id": 10, "source_path": "/home/user/project/main.py", "line": 5 }
        ]);
        let result = rank_thread_candidates(&candidates.to_string(), "/home/user/project");
        let parsed: Vec<RankedFrame> = serde_json::from_str(&result).expect("valid JSON");
        assert_eq!(parsed[0].thread_name, "MainThread");
    }

    #[test]
    fn test_rank_thread_candidates_workspace_over_site_packages() {
        let candidates = json!([
            { "thread_id": 1, "thread_name": "Thread-1", "frame_id": 10, "source_path": "/usr/lib/python3/site-packages/numpy/core.py", "line": 100 },
            { "thread_id": 2, "thread_name": "Thread-2", "frame_id": 20, "source_path": "/home/user/project/analysis.py", "line": 50 }
        ]);
        let result = rank_thread_candidates(&candidates.to_string(), "/home/user/project");
        let parsed: Vec<RankedFrame> = serde_json::from_str(&result).expect("valid JSON");
        assert_eq!(parsed[0].source_path.as_deref(), Some("/home/user/project/analysis.py"));
    }

    #[test]
    fn test_rank_thread_candidates_virtual_source_penalty() {
        let candidates = json!([
            { "thread_id": 1, "thread_name": "Thread-1", "frame_id": 10, "source_path": "<string>", "line": 1 },
            { "thread_id": 2, "thread_name": "Thread-2", "frame_id": 20, "source_path": "/home/user/project/app.py", "line": 10 }
        ]);
        let result = rank_thread_candidates(&candidates.to_string(), "/home/user/project");
        let parsed: Vec<RankedFrame> = serde_json::from_str(&result).expect("valid JSON");
        assert_eq!(parsed[0].source_path.as_deref(), Some("/home/user/project/app.py"));
    }

    #[test]
    fn test_rank_thread_candidates_variable_bonus() {
        let candidates = json!([
            { "thread_id": 1, "thread_name": "Thread-1", "frame_id": 10, "source_path": "/home/user/project/a.py", "line": 10, "has_variable": false },
            { "thread_id": 2, "thread_name": "Thread-2", "frame_id": 20, "source_path": "/home/user/project/b.py", "line": 20, "has_variable": true }
        ]);
        let result = rank_thread_candidates(&candidates.to_string(), "/home/user/project");
        let parsed: Vec<RankedFrame> = serde_json::from_str(&result).expect("valid JSON");
        assert_eq!(parsed[0].frame_id, 20);
    }

    #[test]
    fn test_rank_empty_candidates() {
        let result = rank_thread_candidates("[]", "/home/user/project");
        let parsed: Value = serde_json::from_str(&result).expect("valid JSON");
        assert!(parsed.get("error").is_some());
    }

    #[test]
    fn test_sanitize_source_path_relative() {
        assert_eq!(sanitize_source_path_fn("/home/user/project/src/analysis/process.py", "/home/user/project"), "src_analysis_process");
    }

    #[test]
    fn test_sanitize_source_path_root_file() {
        assert_eq!(sanitize_source_path_fn("/home/user/project/main.py", "/home/user/project"), "main");
    }

    #[test]
    fn test_sanitize_source_path_outside_workspace() {
        assert_eq!(sanitize_source_path_fn("/tmp/external_script.py", "/home/user/project"), "external_script");
    }

    #[test]
    fn test_sanitize_source_path_windows() {
        assert_eq!(sanitize_source_path_fn("C:\\Users\\test\\project\\src\\app.py", "C:\\Users\\test\\project"), "src_app");
    }

    #[test]
    fn test_sanitize_source_path_unsafe_chars() {
        assert_eq!(sanitize_source_path_fn("/home/user/project/my file.py", "/home/user/project"), "my_file");
    }
}
