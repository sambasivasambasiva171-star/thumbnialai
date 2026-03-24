import requests
import json
import base64
import os
import gspread
from google.oauth2.service_account import Credentials
import anthropic

def get_sheets_client():
    sheets_key = json.loads(os.environ.get("SHEETS_KEY_JSON", "{}"))
    scopes = [
        "https://spreadsheets.google.com/feeds",
        "https://www.googleapis.com/auth/drive"
    ]
    creds = Credentials.from_service_account_info(sheets_key, scopes=scopes)
    client = gspread.authorize(creds)
    return client

def load_patterns(sheet_id):
    client = get_sheets_client()
    sheet = client.open_by_key(sheet_id)
    patterns = {}
    for niche in ["Tech", "Fitness"]:
        try:
            worksheet = sheet.worksheet(f"{niche}_patterns")
            data = worksheet.get_all_values()
            if len(data) < 2:
                continue
            headers = data[0]
            for row in data[1:]:
                row_dict = dict(zip(headers, row))
                pattern_id = row_dict.get("pattern_id", "")
                if pattern_id:
                    patterns[pattern_id] = row_dict
        except:
            pass
    return patterns

def find_pattern(patterns, niche, content_format, emotional_hook):
    exact = f"{niche}_{content_format}_{emotional_hook}"
    if exact in patterns:
        return patterns[exact]
    for key, p in patterns.items():
        if p.get("niche") == niche and p.get("content_format") == content_format:
            return p
    for key, p in patterns.items():
        if p.get("niche") == niche:
            return p
    return list(patterns.values())[0] if patterns else None

def generate_prompt(claude_client, topic, niche, content_format, emotional_hook, pattern):
    winning_formula = pattern.get("winning_formula", "")
    prompt = f"""You are a YouTube thumbnail art director.

Video topic: {topic}
Niche: {niche}
Content format: {content_format}
Emotional hook: {emotional_hook}

Winning formula from data: {winning_formula}

Write ONE detailed image generation prompt for Stability AI.
The prompt must:
- Be photorealistic style
- Specify a person with {emotional_hook} expression on their face
- Include background and lighting details from the formula
- NOT include any text in the image
- Be optimized for 16:9 YouTube thumbnail

Return ONLY the prompt text, nothing else."""

    message = claude_client.messages.create(
        model="claude-haiku-4-5",
        max_tokens=300,
        messages=[{"role": "user", "content": prompt}]
    )
    return message.content[0].text.strip()

def generate_image(stability_key, prompt):
    url = "https://api.stability.ai/v2beta/stable-image/generate/core"
    headers = {
        "authorization": f"Bearer {stability_key}",
        "accept": "image/*"
    }
    data = {
        "prompt": prompt,
        "aspect_ratio": "16:9",
        "output_format": "png",
        "style_preset": "photographic"
    }
    response = requests.post(
        url,
        headers=headers,
        files={"none": ""},
        data=data
    )
    if response.status_code == 200:
        return base64.b64encode(response.content).decode("utf-8")
    else:
        raise Exception(f"Stability AI error: {response.text}")

def handler(request):
    if request.method == "OPTIONS":
        return {
            "statusCode": 200,
            "headers": {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type"
            },
            "body": ""
        }

    try:
        body = request.json
        topic = body.get("topic", "")
        niche = body.get("niche", "Tech")
        content_format = body.get("content_format", "review")
        emotional_hook = body.get("emotional_hook", "curiosity")

        sheet_id = os.environ.get("SHEET_ID", "")
        stability_key = os.environ.get("STABILITY_API_KEY", "")
        anthropic_key = os.environ.get("ANTHROPIC_API_KEY", "")

        patterns = load_patterns(sheet_id)
        pattern = find_pattern(patterns, niche, content_format, emotional_hook)

        if not pattern:
            raise Exception("No pattern found")

        claude_client = anthropic.Anthropic(api_key=anthropic_key)

        variants = ["curiosity", "shock", "inspiration"]
        results = []

        for variant in variants:
            prompt = generate_prompt(
                claude_client, topic, niche,
                content_format, variant, pattern
            )
            image_b64 = generate_image(stability_key, prompt)
            results.append({
                "variant": variant,
                "image": f"data:image/png;base64,{image_b64}",
                "overlay_text": get_overlay_text(topic, variant)
            })

        return {
            "statusCode": 200,
            "headers": {
                "Access-Control-Allow-Origin": "*",
                "Content-Type": "application/json"
            },
            "body": json.dumps({"success": True, "thumbnails": results})
        }

    except Exception as e:
        return {
            "statusCode": 500,
            "headers": {"Access-Control-Allow-Origin": "*"},
            "body": json.dumps({"success": False, "error": str(e)})
        }

def get_overlay_text(topic, variant):
    words = topic.upper().split()[:4]
    if variant == "curiosity":
        return " ".join(words[:3]) + "?"
    elif variant == "shock":
        return "YOU WON\'T BELIEVE THIS"
    else:
        return " ".join(words[:3])
