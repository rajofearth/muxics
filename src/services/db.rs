//! SQLite library store (rusqlite, WAL). Stub: schema + user_version
//! migrations land here next. Reads stay on the single writer discipline:
//! one connection owns writes, the UI only ever reads snapshots.
