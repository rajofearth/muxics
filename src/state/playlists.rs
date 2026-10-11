/// Ordered membership preserves duplicates and unresolved entries, unlike
/// the old id-set model.
#[derive(Clone, Debug)]
pub struct Playlist {
    pub id: String,
    pub name: String,
    pub entries: Vec<String>,
}

impl Playlist {
    pub fn new(id: impl Into<String>, name: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            entries: Vec::new(),
        }
    }
}
