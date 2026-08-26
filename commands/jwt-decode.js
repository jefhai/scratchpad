ScratchpadCommands.register({
  id: "jwt-decode", name: "Decode JWT", description: "Read a JWT header and payload",
  category: "Security", icon: "JWT", tags: "jwt token decode security",
  run(text) {
    const [header, payload] = text.trim().split(".");
    if (!header || !payload) throw new Error("That is not a valid JWT");
    const decodePart = (part) => JSON.parse(ScratchpadCommandUtils.decodeBase64(
      part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "="),
    ));
    return JSON.stringify({ header: decodePart(header), payload: decodePart(payload) }, null, 2);
  },
});
