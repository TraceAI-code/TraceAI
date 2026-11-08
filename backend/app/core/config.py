"""Application settings and configuration management.

Reads configuration values from environment variables or a .env file.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """TraceAI application settings."""

    # Database connection string
    database_url: str

    # Supabase cloud storage settings (optional)
    supabase_url: str | None = None
    supabase_key: str | None = None
    supabase_storage_bucket: str = "traceai-evidence"

    # Local folder used if cloud storage is not configured
    local_storage_dir: str = "data/evidence"

    # API configuration
    api_v1_prefix: str = "/api/v1"
    project_name: str = "TraceAI"

    # Comma-separated list of browser origins allowed to call the API.
    # Use "*" to allow any origin (credentials are then disabled automatically).
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    @property
    def cors_origin_list(self) -> list[str]:
        """Return the configured CORS origins as a clean list."""
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    # Settings loader configuration
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )


# Global settings instance
settings = Settings()
