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
        self._query = {}
        self._projection = None
        self._sort_key = None
        self._sort_order = 1
        self._limit_value = None
        self._results = None
    
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
        """Mock find - returns self for chaining"""
        self._query = query or {}
        self._projection = projection
        self._results = None  # Reset results
        return self
    
    def sort(self, key_or_list, direction=1):
        """Mock sort - supports chaining like PyMongo"""
        if isinstance(key_or_list, list):
            self._sort_key = key_or_list[0][0]
            self._sort_order = key_or_list[0][1]
        else:
            self._sort_key = key_or_list
            self._sort_order = direction
        return self
    
    def limit(self, count):
        """Mock limit - supports chaining like PyMongo"""
        self._limit_value = count
        return self
    
    def _compute_results(self):
        """Compute filtered, sorted, and limited results"""
        if self._results is not None:
            return self._results
        
        # Filter
        results = [d.copy() for d in self.data if self._matches(d, self._query or {})]
        
        # Sort
        if self._sort_key:
            results.sort(
                key=lambda x: x.get(self._sort_key, ""),
                reverse=(self._sort_order == -1)
            )
        
        # Limit
        if self._limit_value:
            results = results[:self._limit_value]
        
        # Projection (remove _id if needed)
        if self._projection and "_id" not in self._projection:
            results = [{k: v for k, v in d.items() if k != "_id"} for d in results]
        
        self._results = results
        return results
    
    def __iter__(self):
        """Make collection iterable for list() conversion"""
        return iter(self._compute_results())
    
    def __len__(self):
        """Support len()"""
        return len(self._compute_results())
    
    def find_one(self, query=None):
        """Mock find_one"""
        results = [d for d in self.data if self._matches(d, query or {})]
        if results and self._projection and "_id" not in self._projection:
            return {k: v for k, v in results[0].items() if k != "_id"}
        return results[0] if results else None
    
    def find_one_and_update(self, query, update, return_document=False):
        """Mock find_one_and_update"""
        doc = None
        for d in self.data:
            if self._matches(d, query):
                doc = d
                break
        if doc and "$set" in update:
            doc.update(update["$set"])
        return doc if return_document else None
    
    def update_one(self, query, update):
        """Mock update_one"""
        for d in self.data:
            if self._matches(d, query):
                if "$set" in update:
                    d.update(update["$set"])
                return
    
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
            import certifi
            _client = MongoClient(
                settings.MONGODB_URI,
                tlsCAFile=certifi.where(),
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
