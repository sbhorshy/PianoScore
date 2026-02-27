# PianoScore API

AI-powered piano score recognition and practice backend API.

## Features

- MusicXML parsing and generation
- AI-based sheet music transcription (PDF/Image → MusicXML)
- User progress tracking
- RESTful API with FastAPI

## Tech Stack

- **Framework**: FastAPI
- **AI/ML**: PyTorch, OpenCV
- **Database**: PostgreSQL (async)
- **Deployment**: Docker, Uvicorn

## Project Structure

```
pianoscore-api/
├── app/
│   ├── main.py              # FastAPI entry point
│   ├── routers/
│   │   ├── scores.py        # Score CRUD endpoints
│   │   ├── ai.py            # AI transcription endpoints
│   │   └── users.py         # User endpoints
│   ├── models/
│   │   └── score.py         # Pydantic models
│   ├── services/
│   │   └── ai_recognition.py # AI recognition service
│   └── __init__.py
├── requirements.txt
└── README.md
```

## Installation

```bash
# Create virtual environment
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

## Running

```bash
# Development
uvicorn app.main:app --reload --port 8000

# Production
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## API Documentation

Once running, visit:
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

## AI Model Development

The AI transcription pipeline consists of:

1. **Staff Detection**: YOLO/Detectron2 for detecting staff lines
2. **Note Detection**: Object detection for note heads
3. **Note Classification**: CNN + Transformer for pitch/duration recognition
4. **Post-processing**: Reconstruct measures and output MusicXML

### Training Data

- Public domain sheet music datasets
- Synthetic data generation for augmentation

## License

MIT
