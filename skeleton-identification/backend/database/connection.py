"""
database/connection.py
Async MongoDB connection.

MongoDB is the only supported store. There is deliberately no local-file
fallback: a silent fallback meant a transient network blip during startup
diverted every subsequent write to a JSON file on one machine, where the data
was invisible to the rest of the system and to every other instance. A failed
connection now raises instead, so the problem is seen immediately.
"""
import structlog
from motor.motor_asyncio import AsyncIOMotorClient
from typing import Optional, Any
import socket

# Apply DNS resolution patch for MongoDB Atlas hostnames to handle flaky local DNS/IPv6 config
try:
    import dns.resolver
    _orig_getaddrinfo = socket.getaddrinfo
    _dns_resolver = dns.resolver.Resolver(configure=False)
    _dns_resolver.nameservers = ['8.8.8.8', '1.1.1.1']
    
    # Configure default resolver for dnspython SRV lookup
    dns.resolver.default_resolver = _dns_resolver

    def _patched_getaddrinfo(host, port, *args, **kwargs):
        if 'mongodb.net' in host:
            try:
                answers = _dns_resolver.resolve(host, 'A')
                if answers:
                    return _orig_getaddrinfo(str(answers[0]), port, *args, **kwargs)
            except Exception:
                pass
        return _orig_getaddrinfo(host, port, *args, **kwargs)
        
    socket.getaddrinfo = _patched_getaddrinfo
except Exception:
    pass

log = structlog.get_logger()

class MongoDB:
    """Async MongoDB connection manager."""

    _client: Optional[Any] = None
    _db: Optional[Any] = None

    @classmethod
    async def connect(cls, uri: Optional[str] = None, db_name: Optional[str] = None):
        """Connect to MongoDB, or raise.

        Raises ConnectionError if the server cannot be reached, so startup fails
        loudly rather than quietly writing application data somewhere else.
        """
        from config import settings

        uri = uri or settings.mongodb_uri
        db_name = db_name or settings.mongodb_db

        try:
            log.info("connecting_to_mongodb", uri=uri.split("@")[-1])  # Hide credentials
            cls._client = AsyncIOMotorClient(
                uri,
                serverSelectionTimeoutMS=10000,
                connectTimeoutMS=10000,
                tls=True,
                tlsAllowInvalidCertificates=True,
            )
            # Verify connection
            await cls._client.admin.command("ping")
            cls._db = cls._client[db_name]
            log.info("mongodb_connected_atlas", db=db_name)
            await cls._create_indexes()
        except Exception as e:
            cls._client = None
            cls._db = None
            log.error("mongodb_connection_failed", error=str(e))
            raise ConnectionError(
                f"Could not connect to MongoDB ({uri.split('@')[-1]}): {e}. "
                "MongoDB is required — there is no local fallback."
            ) from e

    @classmethod
    async def _create_indexes(cls):
        """Create required indexes."""
        db = cls.get_db()
        for col_name, key, kwargs in [
            ("users", "user_id", {"unique": True, "sparse": True}),
            ("feature_profiles", "user_id", {"unique": True}),
            ("identification_logs", "timestamp", {}),
            ("trained_models", [("model_type", 1), ("is_active", 1)], {}),
        ]:
            try:
                await db[col_name].create_index(key, **kwargs)
            except Exception as e:
                # If index exists with slightly different specs, ignore safely
                log.debug("index_note", collection=col_name, error=str(e))
        log.info("mongodb_indexes_created")

    @classmethod
    def get_db(cls):
        if cls._db is None:
            raise RuntimeError("Database not connected.")
        return cls._db

    @classmethod
    def get_collection(cls, name: str):
        return cls.get_db()[name]

    @classmethod
    async def close(cls):
        if cls._client:
            cls._client.close()
        cls._client = None
        cls._db = None
        log.info("database_connection_closed")

    @classmethod
    async def is_connected(cls) -> bool:
        try:
            if cls._client:
                await cls._client.admin.command("ping")
                return True
        except: pass
        return False
