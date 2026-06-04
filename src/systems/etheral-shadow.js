/* ============================================================================
 * systems/etheral-shadow.js
 *
 * Vanilla port of the "Etheral Shadow" effect (originally a React +
 * framer-motion component). It layers animated SVG turbulence + a double
 * displacement map over a mask-shaped color blob, then drifts the hue. The
 * original drove the hue with framer-motion's `animate`; here we use a native
 * SMIL <animate> on the feColorMatrix, so this has ZERO dependencies.
 *
 * Usage:  container.appendChild(createEtherealShadow({ color, scale, speed }))
 * ==========================================================================*/

// the smoke silhouette + film-grain textures the original effect uses
const MASK_URL  = "https://framerusercontent.com/images/ceBGguIpUU8luwByxuQz79t7To.png";
const NOISE_URL = "https://framerusercontent.com/images/g0QcWrxr87K0ufOxIUFBakwYA8.png";

function mapRange(v, a, b, c, d) {
  if (a === b) return c;
  return c + ((v - a) / (b - a)) * (d - c);
}

let _uid = 0;

export function createEtherealShadow(opts = {}) {
  const {
    color        = "rgba(95, 110, 180, 1)",
    sizing       = "fill",     // "fill" (cover) | "stretch"
    scale        = 80,         // turbulence/displacement amount (1-100)
    speed        = 70,         // hue-drift speed (1-100)
    noiseOpacity = 0.45,
    noiseScale   = 1.2,
  } = opts;

  const id        = `etheral-${++_uid}`;
  const dispScale = mapRange(scale, 1, 100, 20, 100);
  const hueDurSec = mapRange(speed, 1, 100, 1000, 50) / 25;   // seconds per hue cycle
  const maskSize  = sizing === "stretch" ? "100% 100%" : "cover";
  const turbFreq  = `${mapRange(scale, 0, 100, 0.001, 0.0005)},${mapRange(scale, 0, 100, 0.004, 0.002)}`;

  const root = document.createElement("div");
  root.className = "etheral-shadow";
  root.setAttribute("aria-hidden", "true");
  root.style.cssText = "position:relative;width:100%;height:100%;overflow:hidden;";

  const noiseLayer = noiseOpacity > 0
    ? `<div style="position:absolute;inset:0;background-image:url('${NOISE_URL}');` +
      `background-size:${noiseScale * 200}px;background-repeat:repeat;opacity:${noiseOpacity / 2};"></div>`
    : "";

  root.innerHTML = `
    <div class="es-displace" style="position:absolute;inset:${-dispScale}px;filter:url(#${id}) blur(4px);">
      <svg style="position:absolute" aria-hidden="true">
        <defs>
          <filter id="${id}">
            <feTurbulence result="undulation" numOctaves="2" baseFrequency="${turbFreq}" seed="0" type="turbulence"/>
            <feColorMatrix in="undulation" type="hueRotate" values="180">
              <animate attributeName="values" from="0" to="360" dur="${hueDurSec}s" repeatCount="indefinite"/>
            </feColorMatrix>
            <feColorMatrix in="dist" result="circulation" type="matrix"
              values="4 0 0 0 1  4 0 0 0 1  4 0 0 0 1  1 0 0 0 0"/>
            <feDisplacementMap in="SourceGraphic" in2="circulation" scale="${dispScale}" result="dist"/>
            <feDisplacementMap in="dist" in2="undulation" scale="${dispScale}" result="output"/>
          </filter>
        </defs>
      </svg>
      <div style="background-color:${color};
        -webkit-mask-image:url('${MASK_URL}');mask-image:url('${MASK_URL}');
        -webkit-mask-size:${maskSize};mask-size:${maskSize};
        -webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;
        -webkit-mask-position:center;mask-position:center;
        width:100%;height:100%;"></div>
    </div>
    ${noiseLayer}
  `;

  return root;
}
