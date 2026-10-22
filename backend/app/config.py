from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg2://smartroad:smartroad@localhost:5432/smartroad"
    jwt_secret: str = "dev-only-change-me"
    jwt_expire_minutes: int = 480
    model_path: str = "/models/pothole.pt"
    evidence_dir: str = "/data/evidence"
    min_confidence: float = 0.4
    cors_origins: str = ""
    admin_email: str = ""
    admin_password: str = ""
    max_upload_mb: int = 8

settings = Settings()
