function ExplosionOverlay() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background:
          "radial-gradient(circle, #ffffff 0%, #ff0000 40%, #000000 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 64,
        color: "#fff",
        animation: "shake 0.6s infinite, fadeOut 2s forwards",
        pointerEvents: "none",
        zIndex: 60,
      }}
    >
      💥
    </div>
  );
}

export default ExplosionOverlay;
