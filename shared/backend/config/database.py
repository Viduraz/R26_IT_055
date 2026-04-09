"""
shared/backend/config/database.py
Creates a reusable PyMongo client and returns the project database.
For development without MongoDB, uses in-memory mock.
"""
from pymongo import MongoClient
from pymongo.database import Database
from .settings import settings
import os

_client: MongoClient | None = None
_mock_db = None

# In-memory mock collections for development
_mock_collections = {
    "schedules": [],
    "activity_logs": [],
    "notifications": [],
    "deviations": []
}


class MockDatabase:
    """Mock MongoDB database for development/testing"""
    def __init__(self):
        self.collections = _mock_collections
    
    def __getitem__(self, key):
        """Return a mock collection"""
        if key not in self.collections:
            self.collections[key] = []
        return MockCollection(self.collections[key])


class MockCollection:
    """Mock MongoDB collection for development/testing"""
    def __init__(self, data):
        self.data = data
        self._id_counter = 0
    
    def insert_one(self, doc):
        """Mock insert_one"""
        self._id_counter += 1
        doc["_id"] = str(self._id_counter)
        self.data.append(doc)
        class Result:
            def __init__(self, inserted_id):
                self.inserted_id = inserted_id
        return Result(self._id_counter)
    
    def find(self, query=None, projection=None):
        """Mock find"""
        results = [d for d in self.data if self._matches(d, query or {})]
        if projection and "_id" not in projection:
            results = [{k: v for k, v in d.items() if k != "_id"} for d in results]
        return results
    
    def find_one(self, query=None):
        """Mock find_one"""
        results = self.find(query, None)
        return results[0] if results else None
    
    def find_one_and_update(self, query, update, return_document=False):
        """Mock find_one_and_update"""
        doc = self.find_one(query)
        if doc and "$set" in update:
            doc.update(update["$set"])
        return doc if return_document else None
    
    def update_one(self, query, update):
        """Mock update_one"""
        doc = self.find_one(query)
        if doc and "$set" in update:
            doc.update(update["$set"])
    
    def aggregate(self, pipeline):
        """Mock aggregation"""
        return self.data
    
    def _matches(self, doc, query):
        """Check if document matches query"""
        if not query:
            return True
        for key, value in query.items():
            if key not in doc or doc[key] != value:
                return False
        return True


def get_db() -> Database:
    """Return the shared MongoDB database instance (singleton)."""
    global _client, _mock_db
    
    # Use mock database for development if MongoDB fails
    use_mock = os.getenv("USE_MOCK_DB", "false").lower() == "true"
    
    if use_mock:
        if _mock_db is None:
            _mock_db = MockDatabase()
        return _mock_db
    
    # Try to connect to real MongoDB
    if _client is None:
        try:
            _client = MongoClient(
                settings.MONGODB_URI,
                tlsAllowInvalidCertificates=True,
                tlsInsecure=True,
                serverSelectionTimeoutMS=5000,  # 5 second timeout
                retryWrites=False
            )
            # Test connection
            _client.admin.command('ping')
        except Exception as e:
            print(f"⚠️  MongoDB connection failed: {e}")
            print("🔄 Falling back to mock in-memory database for development")
            _client = None
            _mock_db = MockDatabase()
            return _mock_db
    
    return _client[settings.MONGODB_DB_NAME]


def close_db() -> None:
    """Close the MongoDB connection (call on app shutdown)."""
    global _client
    if _client is not None:
        _client.close()
        _client = None
