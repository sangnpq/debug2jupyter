use wasm_bindgen::prelude::*;
use serde::Serialize;
use serde_json::{json, Value};

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

    let normalized_pkl_path = pkl_path.replace('\\', "/");
    let escaped_pkl_path = normalized_pkl_path
        .replace('\\', "\\\\")
        .replace('\'', "\\'");

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
                    format!("Variable: `{}`", var_name)
                ]
            },
            {
                "cell_type": "code",
                "execution_count": null,
                "id": "d2j-load",
                "metadata": {},
                "outputs": [],
                "source": [
                    "import joblib\n",
                    format!("{} = joblib.load('{}')\n", var_name, escaped_pkl_path),
                    format!("print(f'Loaded {{type({}).__name__}}: {}')\n", var_name, var_name)
                ]
            }
        ]
    });

    serde_json::to_string_pretty(&notebook)
        .unwrap_or_else(|e| error_json("SerializationFailed", &format!("Failed to serialize notebook: {}", e)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_notebook_basic() {
        let result = generate_jupyter_notebook("my_var", "/tmp/my_var.pkl", "myenv");
        let parsed: Value = serde_json::from_str(&result).expect("Should be valid JSON");
        assert_eq!(parsed["nbformat"], 4);
        assert_eq!(parsed["nbformat_minor"], 5);
        assert_eq!(parsed["metadata"]["kernelspec"]["name"], "python3-myenv");
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
        assert_eq!(sanitize_id("My VEnv"), "my-v-env");
        assert_eq!(sanitize_id("simple"), "simple");
        assert_eq!(sanitize_id("a!@#b"), "a---b");
    }

    #[test]
    fn test_kernel_name_format() {
        let result = generate_jupyter_notebook("x", "/x.pkl", "data-science");
        let parsed: Value = serde_json::from_str(&result).expect("Should be valid JSON");
        assert_eq!(parsed["metadata"]["kernelspec"]["name"], "python3-data-science");
        assert_eq!(parsed["metadata"]["kernelspec"]["display_name"], "Python 3 (data-science)");
    }

    #[test]
    fn test_single_quotes_in_path() {
        let result = generate_jupyter_notebook("x", "/tmp/my file's data/x.pkl", "env");
        let parsed: Value = serde_json::from_str(&result).expect("Should be valid JSON");
        let source = parsed["cells"][1]["source"].as_array().unwrap();
        let load_line = source[1].as_str().unwrap();
        assert!(load_line.contains("\\\'"), "Single quote should be escaped: {}", load_line);
    }
}
