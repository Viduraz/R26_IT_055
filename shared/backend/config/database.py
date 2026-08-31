"""
shared/backend/config/database.py
Creates a reusable PyMongo client and returns the project database.
For development without MongoDB, uses in-memory mock.
"""
from pymongo import MongoClient
from pymongo.database import Database
from .settings import settings
import os
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

_client: MongoClient | None = None
_mock_db = None
_mongo_failed = False

# In-memory mock collections for development
_mock_collections = {
    "schedules": [],
    "activity_logs": [],
    "notifications": [],
    "deviations": []
}

# Shared ID counters (class-level, not instance-level) to avoid duplicate IDs
_mock_id_counters: dict = {}


class MockDatabase:
    """Mock MongoDB database for development/testing"""
    def __init__(self):
        self.collections = _mock_collections
    
    def __getitem__(self, key):
        """Return a mock collection"""
        if key not in self.collections:
            self.collections[key] = []
        return MockCollection(self.collections[key], name=key)


class MockCollection:
    """Mock MongoDB collection for development/testing"""
    def __init__(self, data, name="default"):
        self.data = data
        self._name = name
        self._query = {}
        self._projection = None
        self._sort_key = None
        self._sort_order = 1
        self._limit_value = None
        self._results = None
    
    def insert_one(self, doc):
        """Mock insert_one"""
        global _mock_id_counters
        _mock_id_counters[self._name] = _mock_id_counters.get(self._name, 0) + 1
        new_id = _mock_id_counters[self._name]
        doc["_id"] = str(new_id)
        self.data.append(doc)
        class Result:
            def __init__(self, inserted_id):
                self.inserted_id = inserted_id
        return Result(new_id)
    
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
        """Mock update_one — returns an object with matched_count & modified_count"""
        class UpdateResult:
            def __init__(self, matched, modified):
                self.matched_count = matched
                self.modified_count = modified

        for d in self.data:
            if self._matches(d, query):
                if "$set" in update:
                    d.update(update["$set"])
                return UpdateResult(1, 1)
        return UpdateResult(0, 0)

    def delete_one(self, query):
        """Mock delete_one — returns an object with deleted_count"""
        class DeleteResult:
            def __init__(self, count):
                self.deleted_count = count

        for i, d in enumerate(self.data):
            if self._matches(d, query):
                self.data.pop(i)
                return DeleteResult(1)
        return DeleteResult(0)

    def delete_many(self, query):
        """Mock delete_many — returns an object with deleted_count"""
        class DeleteResult:
            def __init__(self, count):
                self.deleted_count = count

        before = len(self.data)
        self.data[:] = [d for d in self.data if not self._matches(d, query)]
        return DeleteResult(before - len(self.data))

    def aggregate(self, pipeline):
        """Mock aggregation"""
        return self.data
    
    def _matches(self, doc, query):
        """Check if document matches query (supports $gte, $lte, $lt, $gt)"""
        if not query:
            return True
        for key, value in query.items():
            doc_val = doc.get(key)
            if isinstance(value, dict):
                # Handle comparison operators
                for op, op_val in value.items():
                    if op == "$gte" and not (doc_val is not None and doc_val >= op_val):
                        return False
                    elif op == "$lte" and not (doc_val is not None and doc_val <= op_val):
                        return False
                    elif op == "$gt" and not (doc_val is not None and doc_val > op_val):
                        return False
                    elif op == "$lt" and not (doc_val is not None and doc_val < op_val):
                        return False
            else:
                if doc_val != value:
                    return False
        return True


def get_db() -> Database:
    """Return the shared MongoDB database instance (singleton)."""
    global _client, _mock_db, _mongo_failed
    
    # Use mock database for development if MongoDB fails
    use_mock = os.getenv("USE_MOCK_DB", "false").lower() == "true" or _mongo_failed
    
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
                serverSelectionTimeoutMS=2000,  # 2 second timeout
                retryWrites=False
            )
            # Test connection
            _client.admin.command('ping')
        except Exception as e:
            print(f"⚠️  MongoDB connection failed: {e}")
            print("🔄 Falling back to mock in-memory database for development")
            _client = None
            _mongo_failed = True
            _mock_db = MockDatabase()
            return _mock_db
    
    # Defensively wrap DB access to fall back on error
    try:
        _client.admin.command('ping')
        return _client[settings.MONGODB_DB_NAME]
    except Exception as e:
        print(f"⚠️  MongoDB connection lost: {e}")
        print("🔄 Falling back to mock in-memory database")
        _mongo_failed = True
        _mock_db = MockDatabase()
        return _mock_db


def close_db() -> None:
    """Close the MongoDB connection (call on app shutdown)."""
    global _client
    if _client is not None:
        _client.close()
        _client = None
