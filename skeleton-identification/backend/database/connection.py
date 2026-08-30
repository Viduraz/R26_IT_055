"""
database/connection.py
Async MongoDB connection with a Local JSON fallback.
If Cloud MongoDB (Atlas) is unreachable, it automatically switches to a local file.
"""
import os
import json
import asyncio
import structlog
from pathlib import Path
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from typing import Optional, Any, Dict, List
from datetime import datetime
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

# ═══════════════════════════════════════════════════════════════════════════════
#  LOCAL DATABASE MOCK (Async JSON Storage)
# ═══════════════════════════════════════════════════════════════════════════════

class LocalCursor:
    """Mock for Motor/MongoDB cursor."""
    def __init__(self, collection, query: Optional[Dict] = None):
        self._collection = collection
        self._query = query
        self._limit = None
        self._sort_key = None
        self._sort_dir = 1

    def sort(self, key: str, direction: int = 1):
        self._sort_key = key
        self._sort_dir = direction
        return self

    def limit(self, n: int):
        self._limit = n
        return self

    async def to_list(self, length: int = 100):
        data = await self._collection._get_data()
        
        # Simple filtering
        if self._query:
            filtered = []
            for doc in data:
                match = True
                for k,v in self._query.items():
                    if k.startswith("$"): continue
                    if isinstance(v, dict) and "$exists" in v:
                        exists = v["$exists"]
                        has_key = k in doc
                        if has_key != exists: match = False; break
                    elif doc.get(k) != v: match = False; break
                if match: filtered.append(doc)
            data = filtered
            
        # Sorting
        if self._sort_key:
            data.sort(key=lambda x: x.get(self._sort_key, 0), reverse=(self._sort_dir == -1))
            
        # Limit
        limit = min(length, self._limit) if self._limit else length
        return data[:limit]

class LocalCollection:
    """Mock for Motor/MongoDB collection using a shared JSON file."""
    def __init__(self, db, name: str):
        self._db = db
        self._name = name

    async def _get_data(self) -> List[Dict]:
        all_data = await self._db._read()
        return all_data.get(self._name, [])

    async def _save_data(self, data: List[Dict]):
        all_data = await self._db._read()
        all_data[self._name] = data
        await self._db._write(all_data)

    async def insert_one(self, doc: Dict):
        data = await self._get_data()
        # Convert datetime to string for JSON serialization
        doc_copy = doc.copy()
        for k, v in doc_copy.items():
            if isinstance(v, datetime): doc_copy[k] = v.isoformat()
            if isinstance(v, dict):
                for k2, v2 in v.items():
                    if isinstance(v2, datetime): v[k2] = v2.isoformat()
        
        data.append(doc_copy)
        await self._save_data(data)
        return type('Result', (), {'inserted_id': 'local_id'})()

    async def find_one(self, query: Dict, projection: Optional[Dict] = None):
        cursor = LocalCursor(self, query)
        results = await cursor.to_list(length=1)
        return results[0] if results else None

    def find(self, query: Dict = None, projection: Optional[Dict] = None):
        return LocalCursor(self, query)

    async def delete_many(self, query: Dict):
        """Mock delete_many."""
        if not query:
            await self._save_data([])
            return type('Result', (), {'deleted_count': 1})()
        
        data = await self._get_data()
        # Simple match-based deletion
        new_data = []
        deleted = 0
        for doc in data:
            match = True
            for k, v in query.items():
                if doc.get(k) != v: match = False; break
            if match: deleted += 1
            else: new_data.append(doc)
        
        await self._save_data(new_data)
        return type('Result', (), {'deleted_count': deleted})()

    async def delete_one(self, query: Dict):
        """Mock delete_one."""
        data = await self._get_data()
        new_data = []
        deleted = 0
        for doc in data:
            if deleted == 0:
                match = True
                for k, v in query.items():
                    if doc.get(k) != v: match = False; break
                if match: 
                    deleted = 1
                    continue
            new_data.append(doc)
        
        await self._save_data(new_data)
        return type('Result', (), {'deleted_count': deleted})()

    async def update_one(self, query: Dict, update: Dict):
        data = await self._get_data()
        for i, doc in enumerate(data):
            match = True
            for k, v in query.items():
                if doc.get(k) != v:
                    match = False
                    break
            if match:
                if "$set" in update:
                    for k, v in update["$set"].items():
                        if isinstance(v, datetime): v = v.isoformat()
                        # Handle nested updates (simple version)
                        if "." in k:
                            parts = k.split(".")
                            target = doc
                            for p in parts[:-1]:
                                if p not in target: target[p] = {}
                                target = target[p]
                            target[parts[-1]] = v
                        else:
                            doc[k] = v
                if "$inc" in update:
                    for k, v in update["$inc"].items():
                        doc[k] = doc.get(k, 0) + v
                data[i] = doc
                await self._save_data(data)
                return type('Result', (), {'modified_count': 1})()
        return type('Result', (), {'modified_count': 0})()

    async def update_many(self, query: Dict, update: Dict):
        # Simplified: just runs logic on all
        data = await self._get_data()
        modified = 0
        for i, doc in enumerate(data):
            match = True
            for k, v in query.items():
                if doc.get(k) != v: match = False; break
            if match:
                if "$set" in update:
                    for k, v in update["$set"].items(): doc[k] = v
                data[i] = doc
                modified += 1
        await self._save_data(data)



    async def count_documents(self, query: Dict):
        data = await self._get_data()
        return len(data)

    async def create_index(self, keys, unique=False):
        pass # Not needed for local file

    def aggregate(self, pipeline: List[Dict]):
        # Mock aggregate: returns recent data for stats
        return LocalCursor(self)

class LocalDatabase:
    """Mock for Motor Database using a JSON file."""
    def __init__(self, path: str):
        self._path = Path(path)
        self._lock = asyncio.Lock()
        if not self._path.parent.exists():
            self._path.parent.mkdir(parents=True)
        if not self._path.exists():
            with open(self._path, "w") as f:
                json.dump({}, f)

    async def _read(self) -> Dict:
        async with self._lock:
            with open(self._path, "r") as f:
                return json.load(f)

    async def _write(self, data: Dict):
        async with self._lock:
            with open(self._path, "w") as f:
                json.dump(data, f, indent=2)

    def __getitem__(self, name: str):
        return LocalCollection(self, name)

    def __getattr__(self, name: str):
        if name.startswith("_"):
            raise AttributeError(name)
        return LocalCollection(self, name)

# ═══════════════════════════════════════════════════════════════════════════════
#  MONGODB CONNECTION MANAGER
# ═══════════════════════════════════════════════════════════════════════════════

class MongoDB:
    """Async MongoDB connection manager with Local Fallback."""

    _client: Optional[Any] = None
    _db: Optional[Any] = None
    _is_local: bool = False

    @classmethod
    async def connect(cls, uri: Optional[str] = None, db_name: Optional[str] = None):
        """Initialize Connection. Fallback to local if URI fails."""
        from config import settings
        
        uri = uri or settings.mongodb_uri
        db_name = db_name or settings.mongodb_db
        
        if settings.use_local_db:
            log.info("using_local_db_forced", path=settings.local_db_path)
            cls._is_local = True
            cls._db = LocalDatabase(settings.local_db_path)
            return

        try:
            log.info("connecting_to_mongodb", uri=uri.split("@")[-1]) # Hide credentials
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
            cls._is_local = False
            log.info("mongodb_connected_atlas", db=db_name)
            await cls._create_indexes()
        except Exception as e:
            log.error("mongodb_atlas_connection_failed", error=str(e))
            log.info("falling_back_to_local_db", path=settings.local_db_path)
            cls._is_local = True
            cls._db = LocalDatabase(settings.local_db_path)

    @classmethod
    async def _create_indexes(cls):
        """Create required indexes (Cloud only)."""
        if cls._is_local: return
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
    async def sync_local_db(cls):
        """Sync data from local JSON database to cloud MongoDB Atlas if needed (fast bulk check)."""
        if cls._is_local:
            return

        from config import settings
        local_db_path = settings.local_db_path
        if not os.path.exists(local_db_path):
            log.info("sync_no_local_db_found", path=local_db_path)
            return

        try:
            log.info("syncing_local_db_to_atlas_started", path=local_db_path)
            with open(local_db_path, "r") as f:
                data = json.load(f)

            db = cls.get_db()
            
            # Fast check for existing user_ids in cloud DB
            existing_user_ids = set(await db.users.distinct("user_id"))
            existing_profile_ids = set(await db.feature_profiles.distinct("user_id"))
            
            # Sync missing users
            users = data.get("users", [])
            users_to_insert = []
            for u in users:
                if u.get("user_id") not in existing_user_ids:
                    u_copy = u.copy()
                    for k in ["created_at", "updated_at"]:
                        if k in u_copy and isinstance(u_copy[k], str):
                            try:
                                u_copy[k] = datetime.fromisoformat(u_copy[k])
                            except Exception:
                                pass
                    users_to_insert.append(u_copy)

            if users_to_insert:
                await db.users.insert_many(users_to_insert)

            # Sync missing feature_profiles
            profiles = data.get("feature_profiles", [])
            profiles_to_insert = []
            for p in profiles:
                if p.get("user_id") not in existing_profile_ids:
                    p_copy = p.copy()
                    if "last_updated" in p_copy and isinstance(p_copy["last_updated"], str):
                        try:
                            p_copy["last_updated"] = datetime.fromisoformat(p_copy["last_updated"])
                        except Exception:
                            pass
                    profiles_to_insert.append(p_copy)

            if profiles_to_insert:
                await db.feature_profiles.insert_many(profiles_to_insert)

            log.info(
                "sync_local_db_to_atlas_success",
                users=len(users_to_insert),
                profiles=len(profiles_to_insert),
                models=0,
            )
        except Exception as e:
            log.warning("sync_local_db_to_atlas_skipped", error=str(e))

    @classmethod
    async def close(cls):
        if cls._client and not cls._is_local:
            cls._client.close()
        cls._client = None
        cls._db = None
        log.info("database_connection_closed")

    @classmethod
    async def is_connected(cls) -> bool:
        if cls._is_local: return True
        try:
            if cls._client:
                await cls._client.admin.command("ping")
                return True
        except: pass
        return False
