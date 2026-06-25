// Route-level loading boundary content. The surrounding layout (sidebar + top
// nav) is already painted by the time a boundary shows, so this only fills the
// main content region — giving instant visual feedback the moment a nav link is
// clicked, while the server renders the real page.
export function PageSkeleton() {
  return (
    <main className="krowe-page" aria-busy="true" aria-label="Loading">
      <div
        className="krowe-page-inner"
        style={{ display: "flex", flexDirection: "column", gap: 20 }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="krowe-skel" style={{ height: 26, width: 220 }} />
          <div className="krowe-skel" style={{ height: 13, width: 320 }} />
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 14,
          }}
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="krowe-skel" style={{ height: 120 }} />
          ))}
        </div>
      </div>
    </main>
  );
}
