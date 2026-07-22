#!/usr/bin/env python3
"""
Local Antigravity / Gemini Agent Runner
---------------------------------------
Executes Antigravity / Gemini AI queries headlessly via Python SDK and outputs text to stdout.
"""

import sys
import argparse
import os
import warnings

# Suppress EOL / SSL warnings from output so JSON/text is clean
warnings.filterwarnings("ignore")

def load_env_local():
    env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env.local")
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    k = k.strip()
                    v = v.strip().strip('"').strip("'")
                    if k not in os.environ:
                        os.environ[k] = v

def main():
    load_env_local()

    parser = argparse.ArgumentParser(description="Antigravity / Gemini Agent Runner")
    parser.add_argument("--prompt", required=True, help="Prompt text")
    parser.add_argument("--images", nargs="*", default=[], help="Image paths")
    parser.add_argument("--model", default="gemini-2.0-flash", help="Model name")
    args = parser.parse_args()

    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        sys.stderr.write(
            "Gemini API key missing. Please add GEMINI_API_KEY=your_key in .env.local "
            "(get one at https://aistudio.google.com/app/api-keys), or switch to 'Claude Code CLI (claude -p)'.\n"
        )
        sys.exit(1)

    # Map model aliases to valid Gemini model identifiers
    target_model = args.model
    if not target_model or target_model.startswith("claude") or "2.5-flash" in target_model:
        target_model = "gemini-2.0-flash"

    # Try importing official Google GenAI SDK (google-genai)
    try:
        from google import genai
        client = genai.Client(api_key=api_key)
        
        contents = [args.prompt]
        for img_path in args.images:
            if os.path.exists(img_path):
                try:
                    from PIL import Image
                    contents.append(Image.open(img_path))
                except Exception:
                    contents.append(f"Referenced image file: {img_path}")

        response = client.models.generate_content(
            model=target_model,
            contents=contents
        )
        print(response.text if hasattr(response, "text") else str(response))
        return
    except ImportError:
        sys.stderr.write("Error: 'google-genai' package import failed.\n")
        sys.exit(1)
    except Exception as e:
        err_msg = str(e)
        if "RESOURCE_EXHAUSTED" in err_msg or "429" in err_msg:
            sys.stderr.write("Gemini Rate Limit / Quota Exceeded (429). Please wait a moment or switch to 'Claude Code CLI (claude -p)'.\n")
        else:
            sys.stderr.write(f"Gemini API Error: {err_msg}\n")
        sys.exit(1)

if __name__ == "__main__":
    main()
