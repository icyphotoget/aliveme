function LoveOverlay() {
  const hearts = Array.from({ length: 20 });

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 48,
        animation: "fadeOut 3s forwards",
        zIndex: 50,
      }}
    >
      {hearts.map((_, i) => (
        <span
          key={i}
          style={{
            position: "absolute",
            left: Math.random() * 100 + "%",
            top: "60%",
            animation: "floatUp 3s ease-out",
          }}
        >
          ❤️
        </span>
      ))}
    </div>
  );
}

export default LoveOverlay;
