(() => {
  const commands = [];

  function register(command) {
    if (!command?.id || typeof command.run !== "function") {
      throw new Error("Invalid Scratchpad command definition");
    }
    if (commands.some((item) => item.id === command.id)) {
      throw new Error(`Duplicate Scratchpad command: ${command.id}`);
    }
    commands.push(Object.freeze(command));
  }

  function words(text) {
    return text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .match(/[A-Za-z0-9]+/g) ?? [];
  }

  function csvEscape(value) {
    const text = value == null
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function parseCsv(text) {
    const rows = [[]];
    let value = "";
    let quoted = false;

    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (quoted && character === '"' && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = !quoted;
      } else if (character === "," && !quoted) {
        rows.at(-1).push(value);
        value = "";
      } else if ((character === "\n" || character === "\r") && !quoted) {
        if (character === "\r" && text[index + 1] === "\n") index += 1;
        rows.at(-1).push(value);
        rows.push([]);
        value = "";
      } else {
        value += character;
      }
    }

    rows.at(-1).push(value);
    if (rows.length > 1 && rows.at(-1).length === 1 && rows.at(-1)[0] === "") {
      rows.pop();
    }
    return rows;
  }

  function sortJson(value) {
    if (Array.isArray(value)) return value.map(sortJson);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.keys(value)
          .sort((left, right) => left.localeCompare(right))
          .map((key) => [key, sortJson(value[key])]),
      );
    }
    return value;
  }

  function encodeBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary);
  }

  function decodeBase64(text) {
    const binary = atob(text.replace(/\s/g, ""));
    return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
  }

  function htmlEncode(text) {
    return text.replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[character]);
  }

  function htmlDecode(text) {
    const textarea = document.createElement("textarea");
    textarea.innerHTML = text;
    return textarea.value;
  }

  function parseInteger(text, radix) {
    const value = Number.parseInt(text.trim(), radix);
    if (!Number.isFinite(value)) throw new Error("That is not a valid number");
    return value;
  }

  async function digest(algorithm, text) {
    const hash = await crypto.subtle.digest(algorithm, new TextEncoder().encode(text));
    return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  const sampleJson = `{
  "array": [
    {
      "field": 0
    },
    {
      "field": 1
    }
  ]
}`;

  const lorem = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer euismod, nisl eget consequat feugiat, neque sem feugiat sapien, vitae ullamcorper sapien justo et augue.";

  globalThis.ScratchpadCommands = Object.freeze({
    register,
    all: () => commands.slice(),
  });

  globalThis.ScratchpadCommandUtils = Object.freeze({
    csvEscape,
    decodeBase64,
    digest,
    encodeBase64,
    htmlDecode,
    htmlEncode,
    lorem,
    parseCsv,
    parseInteger,
    sampleJson,
    sortJson,
    words,
  });
})();
