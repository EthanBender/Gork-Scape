<style>
  :root {
    --ground: #161310;
    --ground-2: #1c1813;
    --panel: #201b15;
    --panel-2: #26201a;
    --line: #38301f;
    --line-soft: #2b241c;
    --ink: #ece4d4;
    --ink-dim: #b8ad98;
    --muted: #928872;
    --skin: #6fbf3f;
    --skin-deep: #4a7c3a;
    --bronze: #e8c65a;
    --amber: #d9a441;
    --blood: #c1554b;
    --water: #4d86bf;
    --purple: #a58fd8;
    --mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
    --sans: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    --disp: "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;
  }

  * { box-sizing: border-box; }

  .doc {
    background:
      radial-gradient(1200px 600px at 18% -8%, #23201a 0%, rgba(35,32,26,0) 60%),
      radial-gradient(900px 500px at 100% 0%, #1d2519 0%, rgba(29,37,25,0) 55%),
      var(--ground);
    color: var(--ink);
    font-family: var(--sans);
    line-height: 1.6;
    font-size: 16px;
    -webkit-font-smoothing: antialiased;
    padding: clamp(20px, 5vw, 64px) clamp(16px, 5vw, 48px) 96px;
  }
  .wrap { max-width: 940px; margin: 0 auto; }

  .doc h1, .doc h2, .doc h3 { font-family: var(--disp); text-wrap: balance; }

  /* ---- masthead ---- */
  .eyebrow {
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: .28em;
    text-transform: uppercase;
    color: var(--skin);
    margin: 0 0 14px;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .eyebrow::before {
    content: "";
    width: 26px; height: 2px;
    background: var(--skin);
    display: inline-block;
  }
  h1.title {
    font-size: clamp(30px, 5.4vw, 52px);
    line-height: 1.04;
    letter-spacing: -0.02em;
    font-weight: 800;
    margin: 0 0 18px;
  }
  h1.title em {
    font-style: normal;
    color: var(--skin);
  }
  .standfirst {
    font-size: clamp(16px, 2.1vw, 19px);
    color: var(--ink-dim);
    max-width: 64ch;
    margin: 0;
  }
  .standfirst b { color: var(--ink); font-weight: 600; }

  .meta {
    display: flex; flex-wrap: wrap; gap: 8px 20px;
    margin-top: 22px;
    font-family: var(--mono);
    font-size: 11.5px;
    color: var(--muted);
    letter-spacing: .04em;
    border-top: 1px solid var(--line-soft);
    padding-top: 16px;
  }
  .meta span b { color: var(--ink-dim); font-weight: 500; }

  /* ---- verdict banner ---- */
  .verdict {
    margin: 40px 0 8px;
    background: linear-gradient(180deg, var(--panel-2), var(--panel));
    border: 1px solid var(--line);
    border-left: 3px solid var(--skin);
    border-radius: 10px;
    padding: 26px 28px;
  }
  .verdict .lbl {
    font-family: var(--mono); font-size: 11px; letter-spacing: .22em;
    text-transform: uppercase; color: var(--skin); margin: 0 0 10px;
  }
  .verdict p { margin: 0; font-size: 18px; line-height: 1.5; }
  .verdict p b { color: var(--bronze); font-weight: 700; }

  /* ---- section scaffolding ---- */
  section { margin-top: 52px; }
  .sec-head {
    display: flex; align-items: baseline; gap: 16px;
    border-bottom: 1px solid var(--line-soft);
    padding-bottom: 12px; margin-bottom: 24px;
  }
  .sec-num {
    font-family: var(--mono);
    font-size: 13px;
    color: var(--skin);
    font-weight: 600;
    letter-spacing: .05em;
    flex: none;
  }
  .sec-head h2 {
    font-size: clamp(20px, 3vw, 27px);
    margin: 0; font-weight: 750; letter-spacing: -0.01em;
  }
  p { margin: 0 0 16px; max-width: 72ch; }
  p:last-child { margin-bottom: 0; }
  strong { color: #fff; font-weight: 650; }
  .k { font-family: var(--mono); font-size: .88em; color: var(--bronze); background: rgba(232,198,90,.08); padding: 1px 5px; border-radius: 4px; border: 1px solid rgba(232,198,90,.16); }
  .hex { font-family: var(--mono); font-size: .85em; color: var(--ink-dim); }

  /* ---- three-tier strip ---- */
  .tiers { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin: 8px 0 4px; }
  .tier {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 18px 18px 20px;
    position: relative;
    overflow: hidden;
  }
  .tier::before { content:""; position:absolute; top:0; left:0; right:0; height:3px; }
  .tier.on::before { background: var(--skin); }
  .tier.off::before { background: var(--amber); }
  .tier.below::before { background: var(--blood); }
  .tier .name { font-family: var(--mono); font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); margin: 6px 0 4px; }
  .tier .what { font-weight: 700; font-size: 16px; margin: 0 0 12px; color: var(--ink); }
  .tier .tag {
    display: inline-block; font-family: var(--mono); font-size: 10.5px; font-weight: 600;
    letter-spacing: .08em; text-transform: uppercase; padding: 3px 9px; border-radius: 20px; margin-bottom: 12px;
  }
  .tier.on .tag { color: var(--skin); background: rgba(111,191,63,.12); border: 1px solid rgba(111,191,63,.3); }
  .tier.off .tag { color: var(--amber); background: rgba(217,164,65,.12); border: 1px solid rgba(217,164,65,.3); }
  .tier.below .tag { color: #e08076; background: rgba(193,85,75,.14); border: 1px solid rgba(193,85,75,.34); }
  .tier .desc { font-size: 13.5px; color: var(--ink-dim); line-height: 1.5; margin: 0; }
  .tier .src { font-family: var(--mono); font-size: 11px; color: var(--muted); margin: 12px 0 0; padding-top: 10px; border-top: 1px solid var(--line-soft); }

  /* ---- invariants table ---- */
  .tbl-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 10px; }
  table { border-collapse: collapse; width: 100%; min-width: 640px; font-size: 14px; }
  thead th {
    text-align: left; font-family: var(--mono); font-size: 11px; letter-spacing: .1em;
    text-transform: uppercase; color: var(--skin); font-weight: 600;
    padding: 13px 16px; background: var(--ground-2); border-bottom: 1px solid var(--line);
  }
  tbody td { padding: 13px 16px; border-bottom: 1px solid var(--line-soft); vertical-align: top; }
  tbody tr:last-child td { border-bottom: none; }
  tbody tr:nth-child(even) { background: rgba(255,255,255,.014); }
  td.inv { font-weight: 650; color: var(--ink); white-space: nowrap; }
  td .rule { color: var(--ink-dim); }

  /* ---- callout / rule cards ---- */
  .card {
    background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
    padding: 20px 22px; margin: 18px 0;
  }
  .card.warn { border-left: 3px solid var(--amber); }
  .card.crit { border-left: 3px solid var(--blood); }
  .card.good { border-left: 3px solid var(--skin); }
  .card h4 { margin: 0 0 8px; font-size: 15px; font-family: var(--disp); font-weight: 700; letter-spacing: .01em; display:flex; align-items:center; gap:9px; }
  .card.warn h4 { color: var(--amber); }
  .card.crit h4 { color: #e08076; }
  .card.good h4 { color: var(--skin); }
  .card p { font-size: 14.5px; color: var(--ink-dim); }
  .dot { width:7px;height:7px;border-radius:50%;flex:none; }
  .card.warn .dot{background:var(--amber);} .card.crit .dot{background:var(--blood);} .card.good .dot{background:var(--skin);}

  /* ---- lighting diagram ---- */
  .lightfig {
    background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
    padding: 24px; margin: 20px 0 8px;
  }
  .lightfig svg { width: 100%; height: auto; display: block; }
  .fig-cap { font-family: var(--mono); font-size: 11.5px; color: var(--muted); margin: 14px 0 0; text-align: center; letter-spacing: .03em; }

  /* ---- decision list ---- */
  .answer { margin-bottom: 14px; }
  .answer .verdict-pill {
    display:inline-block; font-family: var(--mono); font-size: 10.5px; font-weight: 700;
    letter-spacing:.1em; text-transform: uppercase; padding: 3px 10px; border-radius: 5px; margin-bottom: 12px;
  }
  .vp-yes { color: var(--ground); background: var(--skin); }
  .vp-no  { color: #fff; background: var(--blood); }
  .vp-both{ color: var(--ground); background: var(--bronze); }

  ul.tight { margin: 8px 0 16px; padding-left: 0; list-style: none; }
  ul.tight li { position: relative; padding-left: 22px; margin-bottom: 9px; color: var(--ink-dim); max-width: 72ch; }
  ul.tight li::before {
    content: ""; position: absolute; left: 2px; top: 10px;
    width: 6px; height: 6px; background: var(--skin-deep); transform: rotate(45deg);
  }
  ul.tight li b { color: var(--ink); font-weight: 600; }

  /* ---- bottom line ---- */
  .bottomline {
    margin-top: 56px;
    background: linear-gradient(135deg, #1f2a17 0%, var(--panel) 55%);
    border: 1px solid var(--skin-deep);
    border-radius: 12px;
    padding: 32px clamp(22px, 4vw, 40px);
  }
  .bottomline .lbl { font-family: var(--mono); font-size: 11px; letter-spacing: .24em; text-transform: uppercase; color: var(--skin); margin: 0 0 14px; }
  .bottomline p { font-size: clamp(17px, 2.4vw, 21px); line-height: 1.5; color: var(--ink); margin: 0; max-width: none; }
  .bottomline p b { color: var(--bronze); }

  .foot { margin-top: 40px; padding-top: 18px; border-top: 1px solid var(--line-soft); font-family: var(--mono); font-size: 11.5px; color: var(--muted); line-height: 1.7; }
  .foot code { color: var(--ink-dim); }

  @media (max-width: 680px) {
    .tiers { grid-template-columns: 1fr; }
  }
  @media (prefers-reduced-motion: no-preference) {
    .tier, .card { transition: transform .18s ease, border-color .18s ease; }
    .tier:hover { transform: translateY(-2px); border-color: var(--skin-deep); }
  }
</style>

<div class="doc">
<div class="wrap">

  <p class="eyebrow">Gork Scape · Art Direction Decision</p>
  <h1 class="title">One World, One Light.<br><em>Making terrain, props &amp; characters read as a single place.</em></h1>
  <p class="standfirst">The owner is right: the world doesn't mesh. The problem isn't the hero rig — it's <b>three art languages sharing one screen</b>. This resolves the tier war, names the invariants every asset must obey, and prescribes the single lighting rule that a rotating camera makes non-negotiable.</p>

  <div class="meta">
    <span><b>Target:</b> ASSET_GENERATION_SPEC §1 (rendered soft clay)</span>
    <span><b>Camera:</b> rotates — smoothed, snaps to 0/90/180/270</span>
    <span><b>Scope:</b> ~1180 assets · terrain + 10 chars first</span>
  </div>

  <div class="verdict">
    <p class="lbl">The arbitration</p>
    <p>Bring <b>terrain UP</b> and <b>characters UP</b> to the props' rendered-clay bar. The props are on-spec canon — everything else conforms to them, not the reverse. And it is <b>one style bible with per-class recipes</b>, not one LoRA — enforced by a shared lighting law, not a shared generator.</p>
  </div>

  <!-- 1 -->
  <section>
    <div class="sec-head"><span class="sec-num">01</span><h2>The unified target — and why the props win the arbitration</h2></div>
    <p>Confirmed against the spec verbatim. <strong>ASSET_GENERATION_SPEC §1</strong> is the target: <em>"isometric low-poly 3D render, matte surfaces with soft ambient occlusion and gentle bevels, three-quarter top-down at a fixed ~35° elevation, soft neutral studio key light from the upper-left, cohesive warm earthy goblin palette, crisp readable silhouette, no outline, transparent background."</em> That is rendered soft-clay low-poly. The props already are this; terrain and characters are not.</p>

    <div class="tiers">
      <div class="tier on">
        <p class="name">Tier · Props</p>
        <p class="what">Soft rendered clay</p>
        <span class="tag">On-spec · canon</span>
        <p class="desc">42 FLUX/mflux PNGs (25–77&nbsp;KB), baked upper-left AO, rounded bevels. Matches the owner's reference. <b>This is the bar.</b></p>
        <p class="src">assets/objects/*.png</p>
      </div>
      <div class="tier off">
        <p class="name">Tier · Terrain</p>
        <p class="what">Hard faceted flat</p>
        <span class="tag">Off-spec — raise</span>
        <p class="desc">220 tiny (2–3&nbsp;KB) code-drawn facet PNGs. Flat even ambient by design — a <em>different</em> spec doc mandated "no directional light." That's the clash.</p>
        <p class="src">assets/terrain/*.png</p>
      </div>
      <div class="tier below">
        <p class="name">Tier · Characters</p>
        <p class="what">Procedural rig</p>
        <span class="tag">Below-spec — raise</span>
        <p class="desc">avatar.js primitive rig, just got clay shading in Phase 0. Reads near-placeholder beside the props. Weakest tier.</p>
        <p class="src">src/render/avatar.js</p>
      </div>
    </div>
    <p style="margin-top:20px">Props win because they already <em>are</em> the spec, they carry the most rendered information per pixel, and they match the owner's canon reference. Pulling props <em>down</em> to flat facets to "match the ground" would throw away the only tier that already looks finished. So the ground and the goblins come up.</p>
  </section>

  <!-- shared invariants table -->
  <section>
    <div class="sec-head"><span class="sec-num">01·b</span><h2>The shared invariants — every class obeys these five</h2></div>
    <div class="tbl-wrap">
      <table>
        <thead><tr><th>Invariant</th><th>The one rule, no exceptions</th></tr></thead>
        <tbody>
          <tr><td class="inv">Light direction</td><td class="rule"><strong>Upper-left key light</strong>, ~35° elevation, one soft neutral studio source. No second key, no flat ambient-only tier.</td></tr>
          <tr><td class="inv">Palette anchors</td><td class="rule">Locked to §1: skin <span class="hex">#6fbf3f</span> · grass <span class="hex">#4a7c3a</span> · wood <span class="hex">#9a6a3a</span> · steel <span class="hex">#c2cad2</span> · gold <span class="hex">#e8c65a</span> · water <span class="hex">#2e5e8c</span> · bog-magic <span class="hex">#8a6fbf</span>. Every asset lives inside this.</td></tr>
          <tr><td class="inv">Finish</td><td class="rule">Matte low-poly, <strong>soft AO + gentle bevels</strong>. No hard flat facets, no gloss, no outlines.</td></tr>
          <tr><td class="inv">Silhouette</td><td class="rule">Crisp, readable, no outline stroke. Rounded clay volume, not angular primitive.</td></tr>
          <tr><td class="inv">Contact-shadow ownership</td><td class="rule"><strong>The engine owns the ground shadow.</strong> Assets never bake drop-shadows. (§2, and already implemented — see §4.)</td></tr>
        </tbody>
      </table>
    </div>
  </section>

  <!-- 2 -->
  <section>
    <div class="sec-head"><span class="sec-num">02</span><h2>One LoRA, or one bible with per-class recipes?</h2></div>
    <p class="answer"><span class="verdict-pill vp-both">One bible · per-class recipes</span></p>
    <p>A single style LoRA <strong>cannot</strong> span the three classes, because their <em>technical contracts are mutually exclusive</em> and no LoRA overrides them:</p>
    <ul class="tight">
      <li><b>Terrain</b> must be OPAQUE and seamlessly edge-wrapping. A LoRA that renders a lit hero object with an upper-left shadow will never produce a tile that wraps — the baked light gradient <em>is</em> the seam. Tiles need an explicit seamless recipe (tileable sampler / offset-and-heal), not just a style token.</li>
      <li><b>Props</b> are transparent, bottom-anchored, free-form. This is the class a style LoRA fits best.</li>
      <li><b>Character parts</b> are pinned, per-facing, joint-anchored puppet pieces (the proven clay-puppet rig). They're composited live, not generated whole — a LoRA styles the <em>parts</em>, the rig owns pose and rotation.</li>
    </ul>
    <div class="card good">
      <h4><span class="dot"></span>The mechanism</h4>
      <p>One <strong>STYLE BIBLE</strong> (§1 verbatim, the palette anchors, the upper-left light) is the constitution. Under it: <b>one style LoRA trained on ~20 curated prop/clay refs</b>, triggered on every prop and character-part prompt — plus a <b>separate seamless-tile recipe</b> for terrain that inherits the palette and finish but swaps the framing contract. The LoRA is a consistency <em>tool for two classes</em>; the bible is the law for all three.</p>
    </div>
  </section>

  <!-- 3 -->
  <section>
    <div class="sec-head"><span class="sec-num">03</span><h2>The lighting model under a rotating camera</h2></div>
    <p class="answer"><span class="verdict-pill vp-yes">Rule: fixed screen-space (camera-locked) light — world-wide</span></p>
    <p>This is the single biggest hidden cohesion breaker, and the code already forces the answer. The camera rotates (<span class="k">cam.rotation</span>, smoothed, snaps to 90° steps). Props, characters, and labels are <strong>counter-rotated to stay upright</strong> (<span class="k">setRotation(-cam.rotation)</span>) — they're billboards. Their baked upper-left light is therefore <em>already screen-locked</em>. The terrain facets, however, are drawn in world space and rotate <em>with</em> the ground.</p>

    <div class="lightfig">
      <svg viewBox="0 0 720 260" role="img" aria-label="Diagram: a screen-locked upper-left light stays fixed as the world rotates beneath it">
        <defs>
          <radialGradient id="sun" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#ffe9a8"/><stop offset="60%" stop-color="#e8c65a"/><stop offset="100%" stop-color="#e8c65a" stop-opacity="0"/>
          </radialGradient>
          <marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="#e8c65a"/>
          </marker>
        </defs>
        <!-- frame -->
        <rect x="1" y="1" width="718" height="258" rx="10" fill="#161310" stroke="#38301f"/>
        <!-- screen-locked sun, upper-left -->
        <circle cx="86" cy="60" r="46" fill="url(#sun)"/>
        <circle cx="86" cy="60" r="15" fill="#ffe9a8"/>
        <text x="86" y="120" fill="#e8c65a" font-family="monospace" font-size="11" text-anchor="middle" letter-spacing="1">SCREEN LIGHT · FIXED</text>
        <line x1="118" y1="88" x2="200" y2="150" stroke="#e8c65a" stroke-width="2" marker-end="url(#ah)" opacity="0.85"/>

        <!-- world A -->
        <g transform="translate(300,150)">
          <g transform="rotate(0)">
            <rect x="-46" y="-46" width="92" height="92" rx="6" fill="#3f6b30" stroke="#4a7c3a" stroke-width="2"/>
            <rect x="-46" y="-46" width="92" height="46" rx="6" fill="#54864a" opacity="0.5"/>
          </g>
          <text x="0" y="72" fill="#928872" font-family="monospace" font-size="10.5" text-anchor="middle">world @ 0°</text>
        </g>
        <!-- rotate arrow -->
        <path d="M410 150 q40 -34 78 0" fill="none" stroke="#6fbf3f" stroke-width="2" marker-end="url(#ah)"/>
        <text x="449" y="104" fill="#6fbf3f" font-family="monospace" font-size="10.5" text-anchor="middle">camera turns 90°</text>
        <!-- world B -->
        <g transform="translate(560,150)">
          <g transform="rotate(90)">
            <rect x="-46" y="-46" width="92" height="92" rx="6" fill="#3f6b30" stroke="#4a7c3a" stroke-width="2"/>
            <rect x="-46" y="-46" width="92" height="46" rx="6" fill="#54864a" opacity="0.5"/>
          </g>
          <text x="0" y="72" fill="#928872" font-family="monospace" font-size="10.5" text-anchor="middle">world @ 90°</text>
        </g>
        <!-- both lit from same screen sun -->
        <line x1="118" y1="88" x2="524" y2="126" stroke="#e8c65a" stroke-width="1.4" stroke-dasharray="4 5" opacity="0.5" marker-end="url(#ah)"/>
      </svg>
      <p class="fig-cap">The light never turns. The world turns beneath it. Terrain must be lit like the props: flat, no baked directional gradient — so the engine's shared light law governs it too.</p>
    </div>

    <div class="card good">
      <h4><span class="dot"></span>The prescribed rule</h4>
      <p><strong>One fixed screen-space light, upper-left, world-wide.</strong> Baked-light props and the rig already comply (they billboard). Terrain must <em>not</em> bake a directional gradient into the tile — a rotating world-space facet with baked directional shading would sweep its highlight the wrong way every 90°. So faceted terrain stays <b>flat/even-lit in the tile itself</b> and receives its sense of light from the <b>engine's shared shading pass</b> (the same pass that already lifts elevation faces and lays contact shadows), applied in screen space after rotation. Net: assets bake <em>form</em> (AO, bevel volume) but never <em>a directional cast</em> that a turning camera can betray.</p>
    </div>
  </section>

  <!-- 4 -->
  <section>
    <div class="sec-head"><span class="sec-num">04</span><h2>Are the props violating the engine-draws-shadows rule?</h2></div>
    <p class="answer"><span class="verdict-pill vp-no">Yes — and it's a real root cause</span></p>
    <p>The engine <strong>already draws its own contact shadow</strong> under every prop each frame (<span class="k">drawObjects()</span> → <span class="k">g.fillEllipse(cx, cy+TS-2, …, 0x000000, 0.22)</span>). That satisfies §2. But <span class="k">OBJECT_ART_SPEC.md</span> line 21 also invites a <em>baked</em> contact-shadow ellipse into each prop PNG. Result: <strong>double shadow</strong> — a soft baked pool inside the sprite stacked on the engine's live ellipse — and, worse, the baked pool is <em>screen-locked to the sprite</em> while the engine's ellipse tracks the tile, so under camera rotation they drift apart.</p>
    <div class="card crit">
      <h4><span class="dot"></span>Two root causes of the mismatch, named</h4>
      <p><b>(a) The spec fork.</b> <span class="k">docs/TERRAIN_ART_SPEC.md</span> mandates "FLAT even ambient light, NO directional shadow" for tiles, while <span class="k">ASSET_GENERATION_SPEC §1</span> mandates soft upper-left AO for the same world. Two documents, opposite lighting laws — the terrain was built to the wrong one. <b>(b) Baked shadows in props.</b> <span class="k">OBJECT_ART_SPEC.md</span> permits a baked contact ellipse that §2 forbids, double-shadowing every prop and breaking under rotation.</p>
    </div>
    <div class="card warn">
      <h4><span class="dot"></span>The fix</h4>
      <p>Retire <span class="k">docs/TERRAIN_ART_SPEC.md</span> and <span class="k">OBJECT_ART_SPEC.md</span> as independent laws; fold both under <span class="k">ASSET_GENERATION_SPEC</span> as per-class recipe pages that inherit §1 and §2. Re-cut prop PNGs with the baked contact shadow <em>removed</em> (alpha-trim the base pool) so only the engine's ellipse grounds them. Re-generate terrain as clay-finish tiles with <em>form</em>-AO but <em>no directional cast</em>, still seamless.</p>
    </div>
  </section>

  <!-- 5 -->
  <section>
    <div class="sec-head"><span class="sec-num">05</span><h2>Bottom line</h2></div>
    <div class="bottomline">
      <p class="lbl">The smallest rule set that yields a coherent world</p>
      <p>Make <b>ASSET_GENERATION_SPEC §1 the one law</b>; pull terrain and characters up to the props' clay bar; enforce <b>one fixed upper-left screen-space light</b> world-wide (assets bake form, never a directional cast); let the <b>engine own every contact shadow</b> (strip the baked pools from props); and run <b>one style bible with a shared prop/char LoRA plus a separate seamless-tile recipe</b> — because tileability, transparency, and rig-pinning are three contracts one LoRA can't span. Terrain + the ~10 visible characters first: it's the biggest visual win per asset.</p>
    </div>
  </section>

  <p class="foot">
    Verified in <code>~/RGS</code> (live, remote <code>Gork-Scape.git</code>, main): terrain = 220 code-drawn facet PNGs @2–3&nbsp;KB under <code>assets/terrain/</code> (Economy Agent, super-tile 3×3); props = 42 baked renders @25–77&nbsp;KB under <code>assets/objects/</code>; rig = <code>src/render/avatar.js</code>; rotation + counter-rotation in <code>src/main.js</code> (cam.rotation, setRotation(−rot)); engine contact shadow in <code>drawObjects()</code>. Spec fork between <code>ASSET_GENERATION_SPEC.md §1/§2</code> and <code>docs/TERRAIN_ART_SPEC.md</code> / <code>docs/OBJECT_ART_SPEC.md</code> is the arbitrated conflict.
  </p>

</div>
</div>
