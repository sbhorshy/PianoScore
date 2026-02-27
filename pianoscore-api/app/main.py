from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from app.routers import scores, ai, users


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    print("Starting up PianoScore API...")
    yield
    # Shutdown
    print("Shutting down PianoScore API...")


app = FastAPI(
    title="PianoScore API",
    description="AI-powered piano score recognition and practice API",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(scores.router, prefix="/api/scores", tags=["scores"])
app.include_router(ai.router, prefix="/api/ai", tags=["ai"])
app.include_router(users.router, prefix="/api/users", tags=["users"])


@app.get("/")
async def root():
    return {"message": "PianoScore API", "version": "0.1.0"}


@app.get("/health")
async def health_check():
    return {"status": "healthy"}
