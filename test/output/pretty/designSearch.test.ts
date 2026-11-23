import { describe, it, expect } from "vitest";
import { renderDesignSearch } from "../../../src/output/pretty/designSearch.js";

const env = (data: unknown) => ({ code: 0, msg: "success", request_id: "req-1", data });

// picocolors takes colour from the environment, so strip the escapes and the
// assertions mean the same thing with it on or off.
// eslint-disable-next-line no-control-regex
const plain = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");
const render = (data: unknown, ctx?: { group?: string }) => plain(renderDesignSearch(data, ctx));

// Shapes below are the ones the live API returned for each image type.
const webPage = {
  type: "web_page",
  title: "Pricing | Acme",
  description: "A pricing page with a three-column plan comparison.",
  url: "https://img.test/page.png?sig=abc",
  thumbnail: "https://img.test/page-thumb.png?sig=abc",
  source_page: "https://acme.test/pricing",
  width: 1440,
  height: 2732,
  design_facts: {
    color: {
      accent: { $type: "color", $value: { alpha: 1, colorSpace: "srgb", components: [0.69, 0.84, 0.71], hex: "#b1d7b6" } },
      background: { $type: "color", $value: { alpha: 1, colorSpace: "srgb", components: [1, 1, 1], hex: "#ffffff" } },
    },
    fontFamily: {
      body: { $type: "fontFamily", $value: ["Inter"] },
      heading: { $type: "fontFamily", $value: ["Plus Jakarta Sans"] },
    },
    fontSize: { "scale-1": { $type: "dimension", $value: { unit: "px", value: 72 } } },
    radius: { default: { $type: "dimension", $value: { unit: "px", value: 8 } } },
  },
};

const section = {
  type: "web_section",
  title: "Hero",
  url: "https://img.test/hero.png",
  source_page: "https://acme.test/",
  width: 1440,
  height: 900,
  group: { group_id: "page_123", type: "web_page", name: "Acme home", position: 2, total: 12 },
  snippet: { format: "html", code: '<section class="hero"><h1>Ship faster</h1></section>' },
};

const slide = {
  type: "slide",
  title: "The Team",
  url: "https://img.test/slide.png",
  source_page: "https://decks.test/optiwaste.pdf",
  width: 1600,
  height: 900,
  group: {
    group_id: "deck_abc",
    type: "deck",
    name: "OptiWaste",
    position: 19,
    total: 28,
    master: { majorFont: "Arial Black", minorFont: "Tahoma", palette: { accent1: "#00B0F0", dk1: "#000000" } },
  },
  design_facts: { fillColors: ["#0D4F3C", "#2ECC9A"], fontSizesPt: [8.25, 32.3], fonts: ["Montserrat-ExtraBold"], textLines: 31 },
};

const appScreen = {
  type: "app_screen",
  title: "Bank onboarding",
  url: "https://img.test/app.png",
  width: 1080,
  height: 1920,
  design_facts: { layoutFacts: { aspectRatio: 0.5625, clickableCount: 5, components: ["Button", "ImageView"], elementCount: 45 } },
};

describe("design renderer", () => {
  it("reads data.images and prints what identifies each reference", () => {
    const out = render(env({ images: [webPage], results: [] }));
    expect(out).toContain("1. Pricing | Acme");
    expect(out).toContain("web_page · 1440x2732");
    expect(out).toContain("https://img.test/page.png?sig=abc");
    expect(out).toContain("Source: https://acme.test/pricing");
    expect(out).toContain("A pricing page with a three-column plan comparison.");
  });

  it("numbers the references and keeps them apart", () => {
    const out = render(env({ images: [webPage, appScreen] }));
    expect(out).toContain("1. Pricing | Acme");
    expect(out).toContain("2. Bank onboarding");
    expect(out).toContain("app_screen · 1080x1920");
  });

  it("puts the web results under their own heading, after the references", () => {
    const out = render(env({ images: [appScreen], results: [{ title: "A page", url: "https://w.test/a", highlight: "its highlight" }] }));
    expect(out.indexOf("Bank onboarding")).toBeLessThan(out.indexOf("Web results"));
    expect(out.indexOf("Web results")).toBeLessThan(out.indexOf("A page"));
    expect(out).toContain("its highlight");
  });

  it("prints web results alone without a heading", () => {
    const out = render(env({ results: [{ title: "A page", url: "https://w.test/a" }] }));
    expect(out).toContain("1. A page");
    expect(out).not.toContain("Web results");
  });

  describe("design values", () => {
    it("reads design tokens down to the value a person wants", () => {
      const out = render(env({ images: [webPage] }));
      expect(out).toContain("Design values");
      expect(out).toContain("color: accent #b1d7b6, background #ffffff");
      expect(out).toContain("fontFamily: body Inter, heading Plus Jakarta Sans");
      expect(out).toContain("fontSize: scale-1 72px");
      expect(out).toContain("radius: default 8px");
      // The wrapper and the colour-space detail stay in the JSON.
      expect(out).not.toContain("$type");
      expect(out).not.toContain("colorSpace");
    });

    it("keeps the alpha of a colour that is not opaque", () => {
      const out = render(env({ images: [{ title: "T", design_facts: { color: { overlay: { $value: { hex: "#000000", alpha: 0.5 } } } } }] }));
      expect(out).toContain("color: overlay #000000 (alpha 0.5)");
    });

    it("prints the plain lists a slide carries", () => {
      const out = render(env({ images: [slide] }));
      expect(out).toContain("fillColors: #0D4F3C, #2ECC9A");
      expect(out).toContain("fontSizesPt: 8.25, 32.3");
      expect(out).toContain("fonts: Montserrat-ExtraBold");
      expect(out).toContain("textLines: 31");
    });

    it("prints an app screen's nested facts on one line", () => {
      const out = render(env({ images: [appScreen] }));
      expect(out).toContain("layoutFacts: aspectRatio 0.5625, clickableCount 5, components (Button, ImageView), elementCount 45");
    });

    it("prints a shape it has never seen rather than dropping it", () => {
      const out = render(env({ images: [{ title: "T", design_facts: { novel: { a: { b: [1, { c: true }] } }, flag: false } }] }));
      expect(out).toContain("novel: a (b (1, c true))");
      expect(out).toContain("flag: false");
    });

    // One pathological field must not take the whole listing down.
    it("survives design values nested far deeper than any real response", () => {
      let deep: any = "bottom";
      for (let i = 0; i < 50_000; i++) deep = { k: deep };
      const out = render(env({
        images: [{ title: "Deep", design_facts: { deep }, group: { ...slide.group, master: deep } }, appScreen],
        results: [{ title: "A page", url: "https://w.test/a" }],
      }));
      expect(out).toContain("1. Deep");
      expect(out).toContain("deep: k (k (k");
      expect(out).toContain("…");
      expect(out).not.toContain("bottom");
      expect(out).toContain("2. Bank onboarding");
      expect(out).toContain("A page");
    });

    it("prints nothing for values that are absent or empty", () => {
      expect(render(env({ images: [{ title: "T" }] }))).not.toContain("Design values");
      expect(render(env({ images: [{ title: "T", design_facts: {} }] }))).not.toContain("Design values");
      const out = render(env({ images: [{ title: "T", design_facts: { empty: {}, none: [], kept: 1 } }] }));
      expect(out).toContain("kept: 1");
      expect(out).not.toContain("empty:");
      expect(out).not.toContain("none:");
    });

    it("cuts a long line and says the output was shortened", () => {
      const many = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`scale-${i}`, { $value: { unit: "px", value: i } }]));
      const out = render(env({ images: [{ title: "T", design_facts: { fontSize: many } }] }));
      const line = out.split("\n").find((l) => l.includes("fontSize:")) ?? "";
      expect(line.endsWith("…")).toBe(true);
      expect(line.length).toBeLessThan(260);
      expect(out).toContain("--json");
    });
  });

  describe("code", () => {
    it("prints the format, the size and the code", () => {
      const out = render(env({ images: [section] }));
      expect(out).toContain("Code (html, 52 chars)");
      expect(out).toContain('<section class="hero"><h1>Ship faster</h1></section>');
    });

    it("prints short code whole and adds no note about shortening", () => {
      const out = render(env({ images: [section] }));
      expect(out).not.toContain("…");
      expect(out).not.toContain("--json");
    });

    it("cuts long code, says how much there is, and points at --json", () => {
      const code = `<section>${"x".repeat(5000)}</section>`;
      const out = render(env({ images: [{ ...section, snippet: { format: "html", code } }] }));
      expect(out).toContain(`Code (html, ${code.length} chars)`);
      expect(out).toContain("<section>xxx");
      expect(out).not.toContain("</section>");
      expect(out).toContain("--json");
    });

    it("keeps every line of the code indented under its heading", () => {
      const out = render(env({ images: [{ title: "T", snippet: { format: "html", code: "<div>\n<p>a</p>\n</div>" } }] }));
      expect(out).toContain("     <div>\n     <p>a</p>\n     </div>");
    });

    it("prints no code heading when there is no code", () => {
      expect(render(env({ images: [webPage] }))).not.toContain("Code (");
      expect(render(env({ images: [{ title: "T", snippet: { format: "html", code: "" } }] }))).not.toContain("Code (");
    });
  });

  describe("groups", () => {
    it("names the page a section belongs to and how to fetch all of it", () => {
      const out = render(env({ images: [section] }));
      expect(out).toContain("Acme home (web_page) — 2 of 12");
      expect(out).toContain("Whole page: octen design --group page_123 -n 12");
    });

    it("names the deck a slide belongs to and prints its theme", () => {
      const out = render(env({ images: [slide] }));
      expect(out).toContain("OptiWaste (deck) — 19 of 28");
      expect(out).toContain("Whole deck: octen design --group deck_abc -n 28");
      expect(out).toContain("Deck theme: majorFont Arial Black, minorFont Tahoma, palette (accent1 #00B0F0, dk1 #000000)");
    });

    it("prints no theme line for a deck whose master is empty", () => {
      const bare = { ...slide, group: { ...slide.group, master: {} } };
      expect(render(env({ images: [bare] }))).not.toContain("Deck theme");
    });

    // One call returns at most a hundred images, so the command for a larger
    // group fetches part of it and must not be labelled as the whole.
    it("asks for a hundred when the group is larger than one call returns, and says it is a part", () => {
      const big = { ...slide, group: { ...slide.group, total: 152 } };
      const out = render(env({ images: [big] }));
      expect(out).toContain("First 100 of the deck: octen design --group deck_abc -n 100");
      expect(out).not.toContain("Whole deck");
    });

    it("still calls a group of exactly a hundred whole", () => {
      const exact = { ...slide, group: { ...slide.group, total: 100 } };
      expect(render(env({ images: [exact] }))).toContain("Whole deck: octen design --group deck_abc -n 100");
    });

    // The id is printed as part of a command to paste, so it is quoted when
    // pasting it bare would not give the shell one argument.
    it("quotes an id the shell would split", () => {
      const odd = { ...slide, group: { ...slide.group, group_id: "deck a'b" } };
      expect(render(env({ images: [odd] }))).toContain("octen design --group 'deck a'\\''b' -n 28");
    });

    // Without a total the command cannot be told how many to ask for, and
    // the API returns five unless told — so it must not claim the whole.
    it("does not call the command 'whole' when the API gave no total", () => {
      const out = render(env({ images: [{ title: "T", group: { group_id: "g1", name: "A deck", type: "deck" } }] }));
      expect(out).toContain("A deck (deck)");
      expect(out).toContain("More of the deck: octen design --group g1 -n <count> (returns 5 without -n)");
      expect(out).not.toContain("Whole deck");
      expect(out).not.toContain("undefined");
    });

    // The command is meant to be pasted, so the id in it has to be the id the
    // API sent. One that cannot be shown unchanged gets no command.
    it("prints no command for an id that would change on the way to the terminal", () => {
      for (const id of ["deck\tabc", "deck\u001b[2Jabc", "deck\nabc", "deck\u202eabc"]) {
        const out = render(env({ images: [{ ...slide, group: { ...slide.group, group_id: id } }] }));
        expect(out).not.toContain("octen design --group");
        expect(out).toContain("group_id is in the --json output");
      }
    });

    it("keeps the --base-url of the search in the command it prints", () => {
      const out = render(env({ images: [slide] }), { baseUrl: "https://staging.example.test" });
      expect(out).toContain("Whole deck: octen design --group deck_abc -n 28 --base-url https://staging.example.test");
      const odd = render(env({ images: [slide] }), { baseUrl: "http://localhost:8080/a b" });
      expect(odd).toContain("--base-url 'http://localhost:8080/a b'");
      expect(render(env({ images: [slide] }))).not.toContain("--base-url");
    });
  });

  describe("a group lookup", () => {
    const part = [17, 18, 19].map((position) => ({ ...slide, title: `Slide ${position}`, group: { ...slide.group, position } }));

    it("does not repeat the command that was just run on every image", () => {
      const out = render(env({ images: part }), { group: "deck_abc" });
      expect(out).toContain("OptiWaste (deck) — 17 of 28");
      expect(out).not.toContain("Whole deck:");
    });

    // The API returns five of a group unless told otherwise.
    it("says when it shows only part of the group, and how to get the rest", () => {
      const out = render(env({ images: part }), { group: "deck_abc" });
      expect(out).toContain("Showing 3 of 28");
      expect(out).toContain("-n 28");
    });

    it("says a hundred is the most when the group is larger than that", () => {
      const big = part.map((p) => ({ ...p, group: { ...p.group, total: 152 } }));
      const out = render(env({ images: big }), { group: "deck_abc" });
      expect(out).toContain("Showing 3 of 152");
      expect(out).toContain("-n 100");
    });

    it("does not suggest a larger count when the call is already at the most", () => {
      const full = Array.from({ length: 100 }, (_, i) => ({ ...slide, group: { ...slide.group, position: i + 1, total: 152 } }));
      const out = render(env({ images: full }), { group: "deck_abc" });
      expect(out).toContain("Showing 100 of 152");
      expect(out).toContain("at most 100");
      expect(out).not.toContain("add -n");
    });

    it("adds nothing when the whole group is there", () => {
      const whole = [1, 2].map((position) => ({ ...slide, group: { ...slide.group, position, total: 2 } }));
      expect(render(env({ images: whole }), { group: "deck_abc" })).not.toContain("Showing");
    });

    it("adds nothing about the group to an ordinary search", () => {
      expect(render(env({ images: part }))).not.toContain("Showing");
    });

    // An unknown id is answered with an empty success, not an error.
    it("says the group has no images instead of 'No results'", () => {
      const out = render(env({ images: [], results: [] }), { group: "deck_nope" });
      expect(out).toContain("No images in group deck_nope");
      expect(out).not.toContain("No results");
    });

    it("still says so when web results fill the response", () => {
      const out = render(env({ images: [], results: [{ title: "A page", url: "https://w.test/a" }] }), { group: "deck_nope" });
      expect(out).toContain("No images in group deck_nope");
      expect(out).toContain("Web results");
      expect(out).toContain("A page");
    });
  });

  // The text comes from somebody else's page. Written as it is, an escape
  // sequence in it drives the terminal: clears the screen, rewrites a line
  // already printed, retitles the window.
  describe("text that would drive the terminal", () => {
    const ESC = "\u001b";

    it("is shown, not sent, wherever it appears in a reference", () => {
      const out = render(env({
        images: [{
          type: `web${ESC}[2J`,
          title: `Title${ESC}[31m`,
          description: `Line one\rLine two${ESC}]0;x\u0007`,
          url: `https://img.test/a.png${ESC}[H`,
          source_page: `https://a.test/${ESC}[1A`,
          group: { group_id: "g1", type: "deck", name: `Deck${ESC}[0m`, position: 1, total: 2 },
          design_facts: { [`key${ESC}[5m`]: `value${ESC}[6n`, nested: { a: [`x${ESC}c`], [`inner${ESC}[8m`]: 1 } },
          snippet: { format: `html${ESC}[7m`, code: `<p>one</p>\r<p>two</p>${ESC}[2K\u009b1A` },
        }],
      }));
      expect(out).not.toContain(ESC);
      expect(out).not.toContain("\r");
      expect(out).not.toContain("\u0007");
      expect(out).not.toContain("\u009b");
      expect(out).toContain("Title\\x1b[31m");
      expect(out).toContain("key\\x1b[5m: value\\x1b[6n");
      expect(out).toContain("nested: a x\\x1bc, inner\\x1b[8m 1");
      expect(out).toContain("Deck\\x1b[0m (deck)");
    });

    it("keeps a carriage return in the code from overwriting the line before it", () => {
      const out = render(env({ images: [{ title: "T", snippet: { format: "html", code: "<p>one</p>\r<p>two</p>" } }] }));
      expect(out).toContain("     <p>one</p>\n     <p>two</p>");
    });

    it("keeps a multi-line title or description on its own line", () => {
      const out = render(env({ images: [{ title: "First\nSecond", description: "a\nb" }] }));
      expect(out).toContain("1. First Second");
      expect(out).toContain("   a b");
    });

    it("is shown in the web results beside the references", () => {
      const out = render(env({ images: [appScreen], results: [{ title: `Page${ESC}[2J`, url: "https://w.test/a", highlight: `text${ESC}[H` }] }));
      expect(out).not.toContain(ESC);
      expect(out).toContain("Page\\x1b[2J");
    });

    it("is shown in an API error message", () => {
      const out = render({ code: 401, msg: `Bad${ESC}[2J key`+"\rhidden", data: {} });
      expect(out).not.toContain(ESC);
      expect(out).not.toContain("\r");
      expect(out).toContain("error: Bad\\x1b[2J key hidden");
    });

    it("is shown in the id of a group that has no images", () => {
      const out = render(env({ images: [] }), { group: `deck${ESC}[2J` });
      expect(out).not.toContain(ESC);
      expect(out).toContain("No images in group deck\\x1b[2J.");
    });
  });

  describe("empty and malformed responses", () => {
    it("says there are no results", () => {
      expect(render(env({ images: [], results: [] }))).toContain("No results.");
      expect(render(env({}))).toContain("No results.");
      expect(render({})).toContain("No results.");
    });

    it("prints an API error instead of 'No results'", () => {
      const out = render({ code: 401, msg: "Invalid API Key.", data: {} });
      expect(out).toContain("Invalid API Key.");
      expect(out).not.toContain("No results");
    });

    it("renders an un-enveloped response", () => {
      expect(render({ images: [appScreen] })).toContain("Bank onboarding");
    });

    it("skips an entry that is not an object and keeps the ones beside it", () => {
      const out = render(env({ images: [null, "x", appScreen, 7], results: [null, { title: "A page", url: "https://w.test/a" }] }));
      expect(out).toContain("1. Bank onboarding");
      expect(out).toContain("1. A page");
      expect(out).not.toContain("2.");
    });

    // Counted after the malformed entries are dropped: a response made only
    // of them is no results, not an empty listing.
    it("says there are no results when every web result was malformed", () => {
      expect(render(env({ images: [], results: [null, 3] }))).toContain("No results.");
    });

    it("treats a list that is not a list as empty", () => {
      expect(render(env({ images: "nope", results: { a: 1 } }))).toContain("No results.");
    });

    it("prints a reference that is missing its fields without inventing any", () => {
      const out = render(env({ images: [{}] }));
      expect(out).toContain("1. (untitled)");
      expect(out).not.toContain("undefined");
      expect(out).not.toContain("null");
      expect(out).not.toContain("Source:");
    });

    it("ignores fields of the wrong type instead of printing them", () => {
      const out = render(env({
        images: [{ title: 5, url: { a: 1 }, width: "wide", height: 3, group: "g", design_facts: "red", snippet: "code", description: 9 }],
      }));
      expect(out).toContain("1. (untitled)");
      expect(out).not.toContain("[object Object]");
      expect(out).not.toContain("wide");
      expect(out).not.toContain("Design values");
      expect(out).not.toContain("Code (");
    });

    it("does not cut through the middle of a character", () => {
      // The 300th and 301st code units are the two halves of one emoji.
      const out = render(env({ images: [{ title: "T", description: `${"d".repeat(299)}\u{1F600}${"d".repeat(50)}` }] }));
      expect(out).toContain(`${"d".repeat(299)}…`);
      // eslint-disable-next-line no-control-regex
      expect(out).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    });

    it("cuts a long description", () => {
      const out = render(env({ images: [{ title: "T", description: "d".repeat(400) }] }));
      expect(out).toContain(`${"d".repeat(300)}…`);
      expect(out).not.toContain("d".repeat(301));
    });
  });
});
