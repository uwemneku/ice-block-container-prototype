import { useRef, useState } from 'react'
import { useFrame, ThreeEvent } from '@react-three/fiber'
import { useCursor, Text, Line, Billboard } from '@react-three/drei'
import * as THREE from 'three'

// ── Dimensions: 1 unit = 1 inch ───────────────────────────────────────────────
// Interior dimensions (what the user specified)
const IW = 25    // interior width
const IL = 20    // interior length (front-to-back)
const IH = 27    // interior height / depth

const WT = 1.5   // wall thickness
const LH = 2.5   // lid height
const LG = 4     // leg height
const LID_MAX = -Math.PI * 0.56  // ~100° open — lid stands upright, interior visible

// Exterior dimensions (derived)
const W  = IW + WT * 2   // 28"
const Ln = IL + WT * 2   // 23"
const H  = IH + WT       // 22.5" (bottom wall + open-top interior)

// ── Material preset type ──────────────────────────────────────────────────────
interface MatPreset {
  color: string
  roughness: number
  metalness: number
}

const SHELL:  MatPreset = { color: '#f0f0f2', roughness: 0.22, metalness: 0.18 }
const LID_M:  MatPreset = { color: '#e8eaec', roughness: 0.18, metalness: 0.20 }
const INNER:  MatPreset = { color: '#d4d6d8', roughness: 0.32, metalness: 0.55 }
const CHROME: MatPreset = { color: '#999999', roughness: 0.12, metalness: 0.95 }
const RUBBER: MatPreset = { color: '#1e1e1e', roughness: 0.82, metalness: 0.04 }
const COMP:   MatPreset = { color: '#c8c8c8', roughness: 0.55, metalness: 0.25 }
const ACCENT: MatPreset = { color: '#1a4499', roughness: 0.30, metalness: 0.15 }

// ── Extrusion dimensions (shared by RightExtrusion + Dimensions) ───────────────
const EXT_W = 9   // protrudes 9" inward from right interior wall
const EXT_H = 10  // 10" tall from interior floor

// ── Ice-container geometry (tapered rounded rectangle, built once at module load) ──
// Cross-section is a rounded rectangle that grows from bottom to top.
// Back face stays flat against the freezer wall at every level.
const ICE_D_BOT = 3.5,  ICE_D_TOP = 5.0   // depth from wall
const ICE_W_BOT = 3.5,  ICE_W_TOP = 5.0   // total width along wall
const ICE_C_BOT = 1.2,  ICE_C_TOP = 1.8   // corner radius
const ICE_H = 16
const ICE_MAT: MatPreset = { color: '#b8dff0', roughness: 0.18, metalness: 0.08 }

// Returns ordered perimeter points for one cross-section level.
// 4 straight-section starts + 4 corner arcs of nArc samples each = 4+4·nArc points.
function sampleRoundedRectRing(d: number, hw: number, r: number, nArc: number): [number, number][] {
  const pts: [number, number][] = []
  const arcCW = (cx: number, cy: number, a0: number) => {
    for (let i = 0; i < nArc; i++) {
      const a = a0 - (Math.PI / 2) * i / nArc
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
    }
  }
  pts.push([0, -hw + r]);          arcCW(r,      hw - r,  Math.PI)      // back face + top-back corner
  pts.push([r, hw]);               arcCW(d - r,  hw - r,  Math.PI / 2)  // top face  + top-front corner
  pts.push([d, hw - r]);           arcCW(d - r, -hw + r,  0)            // front face + bottom-front corner
  pts.push([d - r, -hw]);          arcCW(r,     -hw + r, -Math.PI / 2)  // bottom face + bottom-back corner
  return pts
}

const ICE_GEO: THREE.BufferGeometry = (() => {
  const N_ARC = 8
  const T     = 2 / 25.4   // side-wall thickness (2 mm ≈ 0.079")
  const T_BOT = 3 / 25.4   // bottom thickness    (3 mm ≈ 0.118")

  const oBot = sampleRoundedRectRing(ICE_D_BOT, ICE_W_BOT / 2, ICE_C_BOT, N_ARC)
  const oTop = sampleRoundedRectRing(ICE_D_TOP, ICE_W_TOP / 2, ICE_C_TOP, N_ARC)

  const iBotRaw = sampleRoundedRectRing(ICE_D_BOT - 2*T, ICE_W_BOT/2 - T, Math.max(ICE_C_BOT - T, 0.05), N_ARC)
  const iTopRaw = sampleRoundedRectRing(ICE_D_TOP - 2*T, ICE_W_TOP/2 - T, Math.max(ICE_C_TOP - T, 0.05), N_ARC)
  const iBot = iBotRaw.map(([x, y]) => [x + T, y] as [number, number])
  const iTop = iTopRaw.map(([x, y]) => [x + T, y] as [number, number])

  const M = oBot.length

  const pos: number[] = []
  const idx: number[] = []
  let vi = 0
  const v = (x: number, y: number, z: number) => { pos.push(x, y, z); return vi++ }

  // Outer side wall — shared rings z=0..ICE_H, CW perimeter → outward normals
  const obi = oBot.map(([x, y]) => v(x, y, 0))
  const oti = oTop.map(([x, y]) => v(x, y, ICE_H))
  for (let i = 0; i < M; i++) {
    const j = (i + 1) % M
    idx.push(obi[i], oti[i], obi[j],  obi[j], oti[i], oti[j])
  }

  // Inner side wall — starts at T_BOT (sits on the floor), reversed → inward normals
  const ibi = iBot.map(([x, y]) => v(x, y, T_BOT))
  const iti = iTop.map(([x, y]) => v(x, y, ICE_H))
  for (let i = 0; i < M; i++) {
    const j = (i + 1) % M
    idx.push(ibi[j], iti[i], ibi[i],  iti[j], iti[i], ibi[j])
  }

  // Outer bottom face — full solid at z = 0, normal −Z
  const cbO = v(ICE_D_BOT / 2, 0, 0)
  for (let i = 0; i < M; i++) {
    const oi = v(oBot[i][0], oBot[i][1], 0)
    const oj = v(oBot[(i + 1) % M][0], oBot[(i + 1) % M][1], 0)
    idx.push(cbO, oi, oj)
  }

  // Inner bottom face — full solid at z = T_BOT, normal +Z (visible inside the cavity)
  const cbI = v(ICE_D_BOT / 2, 0, T_BOT)
  for (let i = 0; i < M; i++) {
    const ii = v(iBot[i][0], iBot[i][1], T_BOT)
    const ij = v(iBot[(i + 1) % M][0], iBot[(i + 1) % M][1], T_BOT)
    idx.push(cbI, ij, ii)   // reversed → +Z normal
  }

  // Bottom edge — angled ring from outer perimeter (z=0) to inner perimeter (z=T_BOT)
  for (let i = 0; i < M; i++) {
    const j = (i + 1) % M
    const oi = v(oBot[i][0], oBot[i][1], 0);    const oj = v(oBot[j][0], oBot[j][1], 0)
    const ii = v(iBot[i][0], iBot[i][1], T_BOT); const ij = v(iBot[j][0], iBot[j][1], T_BOT)
    idx.push(oi, oj, ii,  oj, ij, ii)
  }

  // Top rim — annular ring at z = ICE_H, normal +Z; container is open at the top
  for (let i = 0; i < M; i++) {
    const j = (i + 1) % M
    const oi = v(oTop[i][0], oTop[i][1], ICE_H);  const oj = v(oTop[j][0], oTop[j][1], ICE_H)
    const ii = v(iTop[i][0], iTop[i][1], ICE_H);  const ij = v(iTop[j][0], iTop[j][1], ICE_H)
    idx.push(oi, ii, oj,  oj, ii, ij)
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  return geo
})()

// ── Handle attachment constants (shared by geometry + component) ──────────────
const HND_HZ   = ICE_H * 0.84
const HND_HW   = ICE_W_BOT / 2 + (ICE_W_TOP / 2 - ICE_W_BOT / 2) * (HND_HZ / ICE_H)
const HND_AX   = ICE_D_TOP * 0.44
const HND_PEAK = ICE_H + 5.2

// ── Handle tube: rises vertically from the outer side-wall surface, then arches ─
const HANDLE_GEO: THREE.BufferGeometry = (() => {
  const rise = 2.4   // how far the strap climbs straight up before curving inward

  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(HND_AX, -HND_HW, HND_HZ),                         // left pad (on surface)
    new THREE.Vector3(HND_AX, -HND_HW, HND_HZ + rise),                  // rise vertically
    new THREE.Vector3(HND_AX, -HND_HW * 0.28, HND_HZ + rise + 1.6),    // curve inward
    new THREE.Vector3(HND_AX,  0,              HND_PEAK),                // apex
    new THREE.Vector3(HND_AX,  HND_HW * 0.28, HND_HZ + rise + 1.6),    // mirror
    new THREE.Vector3(HND_AX,  HND_HW, HND_HZ + rise),                  // rise vertically
    new THREE.Vector3(HND_AX,  HND_HW, HND_HZ),                         // right pad (on surface)
  ])
  return new THREE.TubeGeometry(curve, 56, 0.27, 8, false)
})()

// ── Attachment pad: flat disc pressed against the outer side wall ─────────────
const HANDLE_PAD_GEO = new THREE.CylinderGeometry(0.42, 0.42, 0.22, 14)

// ── Sheet-metal flat-pattern geometries ───────────────────────────────────────
// Slant height: measured along the inclined side wall (draft angle ≈2.7°)
const ICE_SH = Math.sqrt(ICE_H ** 2 + ((ICE_D_TOP - ICE_D_BOT) / 2) ** 2)

// Perimeter of the rounded-rect cross-section at each level:  2*(D+W) - 8r + 2πr
const ICE_P_BOT = 2*(ICE_D_BOT + ICE_W_BOT) - 8*ICE_C_BOT + 2*Math.PI*ICE_C_BOT
const ICE_P_TOP = 2*(ICE_D_TOP + ICE_W_TOP) - 8*ICE_C_TOP + 2*Math.PI*ICE_C_TOP

// Bottom plate: rounded rectangle in XY, centred at origin
const SHEET_BOT_GEO = (() => {
  const w = ICE_D_BOT / 2, h = ICE_W_BOT / 2, r = ICE_C_BOT
  const s = new THREE.Shape()
  s.moveTo(-w + r, -h)
  s.lineTo(w - r, -h);  s.quadraticCurveTo(w, -h, w, -h + r)
  s.lineTo(w, h - r);   s.quadraticCurveTo(w, h, w - r, h)
  s.lineTo(-w + r, h);  s.quadraticCurveTo(-w, h, -w, h - r)
  s.lineTo(-w, -h + r); s.quadraticCurveTo(-w, -h, -w + r, -h)
  return new THREE.ShapeGeometry(s, 12)
})()
const SHEET_BOT_EDGES = new THREE.EdgesGeometry(SHEET_BOT_GEO)

// Wrap-around side sheet: one piece that rolls to form all four walls + corners.
// Width = full perimeter at that level; height = slant height ICE_SH.
// Shape is centred at origin so the group-centre stays in the middle of the panel.
const SHEET_WRAP_GEO = (() => {
  const bw = ICE_P_BOT / 2, tw = ICE_P_TOP / 2, h = ICE_SH / 2
  const s = new THREE.Shape()
  s.moveTo(-bw, -h); s.lineTo(bw, -h)   // narrow end (bottom of container)
  s.lineTo(tw,   h); s.lineTo(-tw,  h)  // wide end (top of container)
  s.closePath()
  return new THREE.ShapeGeometry(s)
})()
const SHEET_WRAP_EDGES = new THREE.EdgesGeometry(SHEET_WRAP_GEO)

// ── Dimension-line style ───────────────────────────────────────────────────────
const DIM_COL = '#f5cc30'
const CONE_R  = 0.22
const CONE_H  = 0.85

// ── Shared event handler shape ────────────────────────────────────────────────
interface MeshEvents {
  onClick?: (e: ThreeEvent<MouseEvent>) => void
  onPointerOver?: (e: ThreeEvent<PointerEvent>) => void
  onPointerOut?: (e: ThreeEvent<PointerEvent>) => void
}

// ── Box helper ────────────────────────────────────────────────────────────────
interface BoxProps extends MeshEvents {
  pos: [number, number, number]
  size: [number, number, number]
  mat: MatPreset
  shadow?: boolean
}

function Box({ pos, size, mat, shadow = true, ...events }: BoxProps) {
  return (
    <mesh position={pos} castShadow={shadow} receiveShadow={shadow} {...events}>
      <boxGeometry args={size} />
      <meshStandardMaterial {...mat} />
    </mesh>
  )
}

// ── Cylinder helper ───────────────────────────────────────────────────────────
interface CylProps extends MeshEvents {
  pos: [number, number, number]
  rot?: [number, number, number]
  args: [number, number, number, number]
  mat: MatPreset
  shadow?: boolean
}

function Cyl({ pos, rot, args, mat, shadow = true, ...events }: CylProps) {
  return (
    <mesh position={pos} rotation={rot} castShadow={shadow} receiveShadow={shadow} {...events}>
      <cylinderGeometry args={args} />
      <meshStandardMaterial {...mat} />
    </mesh>
  )
}

// ── FreezerBody ───────────────────────────────────────────────────────────────
function FreezerBody() {
  const RW   = WT * 0.75
  const rimY = LG + H - 0.28

  const mid = LG + H / 2

  return (
    <group>
      {/* Open-top shell — 5 panels so the interior is visible from above */}
      <Box pos={[0, LG + WT / 2,      0           ]} size={[W,  WT, Ln ]} mat={SHELL} /> {/* bottom */}
      <Box pos={[0, mid,               Ln/2 - WT/2 ]} size={[W,  H,  WT ]} mat={SHELL} /> {/* front  */}
      <Box pos={[0, mid,              -Ln/2 + WT/2 ]} size={[W,  H,  WT ]} mat={SHELL} /> {/* back   */}
      <Box pos={[-W/2 + WT/2, mid,    0            ]} size={[WT, H,  Ln ]} mat={SHELL} /> {/* left   */}
      <Box pos={[ W/2 - WT/2, mid,    0            ]} size={[WT, H,  Ln ]} mat={SHELL} /> {/* right  */}

      {/* Interior aluminium lining — 5 FrontSide planes, each facing inward,
          offset ε from shell panels to avoid z-fighting */}
      {(() => {
        const e   = 0.02
        const midY = LG + WT + IH / 2
        const mat  = <meshStandardMaterial {...INNER} />
        return (
          <>
            {/* floor — normal +y */}
            <mesh position={[0, LG + WT + e, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[IW, IL]} />{mat}
            </mesh>
            {/* back wall — normal +z */}
            <mesh position={[0, midY, -IL / 2 + e]}>
              <planeGeometry args={[IW, IH]} />{mat}
            </mesh>
            {/* front wall — normal -z */}
            <mesh position={[0, midY, IL / 2 - e]} rotation={[0, Math.PI, 0]}>
              <planeGeometry args={[IW, IH]} />{mat}
            </mesh>
            {/* left wall — normal +x */}
            <mesh position={[-IW / 2 + e, midY, 0]} rotation={[0, Math.PI / 2, 0]}>
              <planeGeometry args={[IL, IH]} />{mat}
            </mesh>
            {/* right wall — normal -x */}
            <mesh position={[IW / 2 - e, midY, 0]} rotation={[0, -Math.PI / 2, 0]}>
              <planeGeometry args={[IL, IH]} />{mat}
            </mesh>
          </>
        )
      })()}

      {/* Rubber gasket – front & back */}
      {([Ln / 2 - RW / 2, -Ln / 2 + RW / 2] as const).map((rz, i) => (
        <Box key={i} pos={[0, rimY, rz]} size={[W, 0.5, RW]} mat={RUBBER} shadow={false} />
      ))}
      {/* Rubber gasket – left & right */}
      {([W / 2 - RW / 2, -W / 2 + RW / 2] as const).map((rx, i) => (
        <Box key={i} pos={[rx, rimY, 0]} size={[RW, 0.5, Ln - RW * 2]} mat={RUBBER} shadow={false} />
      ))}
    </group>
  )
}

// ── FreezerLegs ───────────────────────────────────────────────────────────────
function FreezerLegs() {
  const corners: [number, number][] = [
    [ W / 2 - 2.8,  Ln / 2 - 2.8],
    [-W / 2 + 2.8,  Ln / 2 - 2.8],
    [ W / 2 - 2.8, -Ln / 2 + 2.8],
    [-W / 2 + 2.8, -Ln / 2 + 2.8],
  ]
  return (
    <group>
      {corners.map(([lx, lz], i) => (
        <group key={i}>
          <Cyl pos={[lx, LG / 2, lz]} args={[1.1, 1.35, LG, 12]} mat={RUBBER} />
          <Cyl pos={[lx, 0.25,   lz]} args={[1.9, 1.9,  0.5, 12]} mat={RUBBER} />
        </group>
      ))}
    </group>
  )
}

// ── Compressor ────────────────────────────────────────────────────────────────
function Compressor() {
  const grilleOffsets = [-3, -2, -1, 0, 1, 2, 3] as const
  return (
    <group>
      <Box pos={[W / 2 - 5.5, LG + 4, -Ln / 2 - 3.5]} size={[10, 8, 7]} mat={COMP} />

      {grilleOffsets.map(i => (
        <Box
          key={i}
          pos={[W / 2 - 5.5, LG + 4 + i * 0.85, -Ln / 2 - 7.1]}
          size={[8, 0.25, 0.2]}
          mat={RUBBER}
          shadow={false}
        />
      ))}

      <Cyl
        pos={[W / 2 - 1.5, LG + 7.5, -Ln / 2 - 3.5]}
        rot={[0, 0, Math.PI / 2]}
        args={[0.4, 0.4, 6, 10]}
        mat={CHROME}
        shadow={false}
      />
    </group>
  )
}

// ── ControlPanel ──────────────────────────────────────────────────────────────
function ControlPanel() {
  const px = -W / 2 + 5
  const py = LG + H - 5.5
  const pz = Ln / 2

  return (
    <group>
      <Box pos={[px, py, pz + 0.2]} size={[5.5, 4.5, 0.3]} mat={COMP} />

      <Cyl
        pos={[px, py, pz + 0.56]}
        rot={[Math.PI / 2, 0, 0]}
        args={[1.3, 1.3, 0.6, 24]}
        mat={CHROME}
        shadow={false}
      />

      <mesh position={[px, py + 1.25, pz + 0.6]}>
        <sphereGeometry args={[0.22, 10, 10]} />
        <meshStandardMaterial color="#ff2222" roughness={0.4} emissive="#ff0000" emissiveIntensity={0.6} />
      </mesh>

      <mesh position={[px + 2.5, py, pz + 0.5]}>
        <sphereGeometry args={[0.3, 10, 10]} />
        <meshStandardMaterial color="#00ee55" roughness={0.3} emissive="#00ff44" emissiveIntensity={1.8} />
      </mesh>
    </group>
  )
}

// ── RightExtrusion ────────────────────────────────────────────────────────────
// 9" wide × 10" tall block on the interior right wall, sitting on the floor
function RightExtrusion() {
  const cx = IW / 2 - EXT_W / 2
  const cy = LG + WT + EXT_H / 2
  return <Box pos={[cx, cy, 0]} size={[EXT_W, EXT_H, IL]} mat={INNER} />
}

// ── Ice Block Container ───────────────────────────────────────────────────────
// D-shaped upright container: flat chord face contacts a freezer wall,
// curved arc faces into the interior.  All four wall orientations share the
// same geometry; only the Z Euler angle differs:
//
//   facing  rotZ      arc direction   chord direction
//   left    0         +X (rightward)  ±Z
//   right   π         −X (leftward)   ±Z
//   front   +π/2      −Z (rearward)   ±X
//   back    −π/2      +Z (forward)    ±X
type ContainerFacing = 'left' | 'right' | 'front' | 'back'

interface IceContainerProps {
  x: number
  y?: number   // floor level; defaults to interior floor
  z: number
  facing: ContainerFacing
}

function IceContainer({ x, y = LG + WT, z, facing }: IceContainerProps) {
  const rotZ =
    facing === 'right' ?  Math.PI       :
    facing === 'front' ?  Math.PI / 2   :
    facing === 'back'  ? -Math.PI / 2   : 0

  // Pads sit flush against the outer ±y side walls; cylinder axis is local Y.
  const padOffset = 0.11   // half pad height — centres the disc just outside the wall
  return (
    <group position={[x, y, z]} rotation={[-Math.PI / 2, 0, rotZ]}>
      <mesh geometry={ICE_GEO} castShadow receiveShadow>
        <meshStandardMaterial {...ICE_MAT} />
      </mesh>
      <mesh geometry={HANDLE_GEO} castShadow>
        <meshStandardMaterial {...RUBBER} />
      </mesh>
      {/* Left attachment pad */}
      <mesh geometry={HANDLE_PAD_GEO} position={[HND_AX, -HND_HW - padOffset, HND_HZ]} castShadow>
        <meshStandardMaterial {...RUBBER} />
      </mesh>
      {/* Right attachment pad */}
      <mesh geometry={HANDLE_PAD_GEO} position={[HND_AX,  HND_HW + padOffset, HND_HZ]} castShadow>
        <meshStandardMaterial {...RUBBER} />
      </mesh>
    </group>
  )
}

function IceContainers() {
  const ZS       = [-6, 0, 6] as const
  const floorY   = LG + WT
  const extTopY  = floorY + EXT_H        // top surface of the extrusion
  const leftX    = -IW / 2               // flat against left interior wall
  const rightX   =  IW / 2 - EXT_W      // flat against extrusion left face
  const centerX  = (leftX + rightX) / 2  // centre of non-extruded span

  // Chord position for the single centre-floor container (facing left, 0.5″ clear of left-column arc tips)
  const midChordX = leftX + ICE_D_TOP + 0.5   // = −7.0

  return (
    <group>
      {/* Left and right columns — 3 each at floor level */}
      {ZS.map(z => <IceContainer key={`L${z}`} x={leftX}  z={z} facing="left"  />)}
      {ZS.map(z => <IceContainer key={`R${z}`} x={rightX} z={z} facing="right" />)}

      {/* Centre-front and centre-back singles at floor level */}
      <IceContainer x={centerX} z={ IL / 2} facing="front" />
      <IceContainer x={centerX} z={-IL / 2} facing="back"  />

      {/* Single centre-floor container in the gap between the two columns */}
      <IceContainer x={midChordX} z={0} facing="left" />

      {/* Three on top of the extrusion — flat against the right interior wall */}
      {ZS.map(z => (
        <IceContainer key={`T${z}`} x={IW / 2} y={extTopY} z={z} facing="right" />
      ))}
    </group>
  )
}

// ── Standalone container with dimension callouts ───────────────────────────────
function StandaloneContainer() {
  const px     = -(W / 2 + 20)      // chord x: well clear of the freezer left wall
  const py     = 6                   // lift off the ground so bottom labels are visible
  const pz     = 0
  const tipTop = px + ICE_D_TOP      // top arc-tip x
  const tipBot = px + ICE_D_BOT      // bottom arc-tip x
  const hwTop  = ICE_W_TOP / 2       // top half-width along Z
  const hwBot  = ICE_W_BOT / 2       // bottom half-width along Z

  return (
    <group>
      <IceContainer x={px} y={py} z={pz} facing="left" />

      {/* ── Top dimensions ── */}
      <DimLine
        start={[tipTop + 3, py + ICE_H + 1, pz - hwTop]}
        end={  [tipTop + 3, py + ICE_H + 1, pz + hwTop]}
        label={`${ICE_W_TOP} in`}
      />
      <DimLine
        start={[px,     py + ICE_H + 1, pz - hwTop - 3]}
        end={  [tipTop, py + ICE_H + 1, pz - hwTop - 3]}
        label={`${ICE_D_TOP} in`}
      />

      {/* ── Bottom dimensions ── */}
      <DimLine
        start={[tipBot + 3, py - 2, pz - hwBot]}
        end={  [tipBot + 3, py - 2, pz + hwBot]}
        label={`${ICE_W_BOT} in`}
      />
      <DimLine
        start={[px,     py - 2, pz - hwBot - 3]}
        end={  [tipBot, py - 2, pz - hwBot - 3]}
        label={`${ICE_D_BOT} in`}
      />

      {/* ── Height ── */}
      <DimLine
        start={[tipTop + 3, py,          pz + hwTop + 3]}
        end={  [tipTop + 3, py + ICE_H,  pz + hwTop + 3]}
        label={`${ICE_H} in`}
      />
    </group>
  )
}

// ── Sheet Metal Flat Patterns ─────────────────────────────────────────────────
// Two pieces:
//  1. Wrap sheet — one continuous trapezoid that rolls around the perimeter
//     to form all four walls (seam on one flat side). Width = full perimeter at each level.
//  2. Bottom plate — the rounded-rectangle base.
function SheetMetalPatterns() {
  const CX        = W / 2 + ICE_P_BOT / 2 + 6   // left edge of wrap sheet ≈ 26" from centre
  const CZ        = 0
  const botOffset = ICE_P_TOP / 2 + 4 + ICE_D_BOT / 2  // gap = 4"

  const face = (
    <meshStandardMaterial color="#d8e4ea" roughness={0.52} metalness={0.28} side={THREE.DoubleSide} />
  )
  const edge = <lineBasicMaterial color="#7ab8d0" />

  return (
    <>
      <pointLight position={[CX + botOffset / 2, ICE_SH / 2, 15]} intensity={7} color="#e8eeff" distance={90} decay={1.1} />

      <Billboard position={[CX + botOffset / 2, ICE_SH + 5, CZ]}>
        <Text fontSize={1.8} color="#ffdd88" anchorX="center" anchorY="bottom">
          Sheet Metal Flat Patterns
        </Text>
      </Billboard>

      {/* No rotation — ShapeGeometry lives in XY plane, face normal = +Z toward camera */}
      <group position={[CX, 0, CZ]}>

        {/* ── Wrap-around side sheet ── centred shape lifted so narrow bottom sits at y=0 */}
        <mesh geometry={SHEET_WRAP_GEO} position={[0, ICE_SH / 2, 0]}>{face}</mesh>
        <lineSegments geometry={SHEET_WRAP_EDGES} position={[0, ICE_SH / 2, 0]}>{edge}</lineSegments>
        <Billboard position={[0, ICE_SH / 2, 0.3]}>
          <Text fontSize={1.05} color="#e8f0ff" textAlign="center"
                outlineWidth={0.04} outlineColor="#111">
            {`Side Sheet ×1\nRoll & seam to form all walls\n${ICE_P_BOT.toFixed(2)}"→${ICE_P_TOP.toFixed(2)}" wide · ${ICE_H}" tall`}
          </Text>
        </Billboard>

        {/* ── Bottom plate ── centred shape lifted so bottom sits at y=0 */}
        <mesh geometry={SHEET_BOT_GEO} position={[botOffset, ICE_D_BOT / 2, 0]}>{face}</mesh>
        <lineSegments geometry={SHEET_BOT_EDGES} position={[botOffset, ICE_D_BOT / 2, 0]}>{edge}</lineSegments>
        <Billboard position={[botOffset, ICE_D_BOT / 2, 0.3]}>
          <Text fontSize={1.05} color="#e8f0ff" textAlign="center"
                outlineWidth={0.04} outlineColor="#111">
            {`Bottom Plate ×1\n${ICE_D_BOT}"×${ICE_W_BOT}"\nr = ${ICE_C_BOT}"`}
          </Text>
        </Billboard>
      </group>

      {/* Dimension callouts — wrap sheet (narrow bottom at y=0, wide top at y=ICE_SH) */}
      <DimLine
        start={[CX - ICE_P_BOT / 2,     0.5,          CZ + 2]}
        end={  [CX + ICE_P_BOT / 2,     0.5,          CZ + 2]}
        label={`${ICE_P_BOT.toFixed(2)} in`}
      />
      <DimLine
        start={[CX - ICE_P_TOP / 2,     ICE_SH + 2,   CZ + 2]}
        end={  [CX + ICE_P_TOP / 2,     ICE_SH + 2,   CZ + 2]}
        label={`${ICE_P_TOP.toFixed(2)} in`}
      />
      <DimLine
        start={[CX + ICE_P_TOP / 2 + 3, 0,            CZ + 2]}
        end={  [CX + ICE_P_TOP / 2 + 3, ICE_SH,       CZ + 2]}
        label={`${ICE_SH.toFixed(2)} in`}
      />

      {/* Dimension callouts — bottom plate (y from 0 to ICE_W_BOT) */}
      <DimLine
        start={[CX + botOffset - ICE_D_BOT / 2,     0.5,       CZ + 2]}
        end={  [CX + botOffset + ICE_D_BOT / 2,     0.5,       CZ + 2]}
        label={`${ICE_D_BOT} in`}
      />
      <DimLine
        start={[CX + botOffset + ICE_D_BOT / 2 + 2, 0,         CZ + 2]}
        end={  [CX + botOffset + ICE_D_BOT / 2 + 2, ICE_W_BOT, CZ + 2]}
        label={`${ICE_W_BOT} in`}
      />
    </>
  )
}

// ── Engineering Dimension Labels ──────────────────────────────────────────────
function Arrowhead({ pos, rot }: {
  pos: [number, number, number]
  rot: [number, number, number]
}) {
  return (
    <mesh position={pos} rotation={rot}>
      <coneGeometry args={[CONE_R, CONE_H, 8]} />
      <meshStandardMaterial color={DIM_COL} roughness={0.3} metalness={0.4} />
    </mesh>
  )
}

function DimLine({ start, end, label }: {
  start: [number, number, number]
  end:   [number, number, number]
  label: string
}) {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const dz = end[2] - start[2]
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz)
  const f   = (CONE_H / 2) / len

  // Inset arrowhead centres so tips sit exactly on the endpoints
  const pS: [number, number, number] = [start[0] + dx * f, start[1] + dy * f, start[2] + dz * f]
  const pE: [number, number, number] = [end[0]   - dx * f, end[1]   - dy * f, end[2]   - dz * f]

  const adx = Math.abs(dx), ady = Math.abs(dy), adz = Math.abs(dz)

  // Cone default: tip along +Y.  rotations map +Y → desired tip direction.
  let rotS: [number, number, number] = [0, 0, 0]
  let rotE: [number, number, number] = [Math.PI, 0, 0]
  let offX = 0, offY = 0

  if (adx >= ady && adx >= adz) {
    rotS = dx > 0 ? [0, 0, -Math.PI / 2] : [0, 0,  Math.PI / 2]
    rotE = dx > 0 ? [0, 0,  Math.PI / 2] : [0, 0, -Math.PI / 2]
    offY = 1.8
  } else if (adz >= ady) {
    rotS = dz > 0 ? [-Math.PI / 2, 0, 0] : [Math.PI / 2, 0, 0]
    rotE = dz > 0 ? [ Math.PI / 2, 0, 0] : [-Math.PI / 2, 0, 0]
    offY = 1.8
  } else {
    rotS = dy > 0 ? [0, 0, 0] : [Math.PI, 0, 0]
    rotE = dy > 0 ? [Math.PI, 0, 0] : [0, 0, 0]
    offX = 2.4
  }

  const mid: [number, number, number] = [
    (start[0] + end[0]) / 2 + offX,
    (start[1] + end[1]) / 2 + offY,
    (start[2] + end[2]) / 2,
  ]

  return (
    <group>
      <Line points={[start, end]} color={DIM_COL} lineWidth={1.5} />
      <Arrowhead pos={pS} rot={rotS} />
      <Arrowhead pos={pE} rot={rotE} />
      <Billboard position={mid}>
        <Text fontSize={1.6} color={DIM_COL} anchorX="center" anchorY="middle"
              outlineWidth={0.06} outlineColor="#111111">
          {label}
        </Text>
      </Billboard>
    </group>
  )
}

function Dimensions() {
  const floorY = LG + WT
  const rimY   = floorY + IH
  const frontZ = Ln / 2 + 5   // in front of the freezer
  const rightX = W  / 2 + 5   // to the right of the freezer

  return (
    <group>
      {/* Interior width — 25 in, horizontal in front at floor level */}
      <DimLine start={[-IW / 2, floorY, frontZ]} end={[IW / 2, floorY, frontZ]} label="25 in" />

      {/* Interior length — 20 in, horizontal on the right at floor level */}
      <DimLine start={[rightX, floorY, -IL / 2]} end={[rightX, floorY, IL / 2]} label="20 in" />

      {/* Interior depth — 27 in, vertical front-right */}
      <DimLine start={[rightX, floorY, frontZ]} end={[rightX, rimY, frontZ]} label="27 in" />

      {/* Extrusion width — 9 in, horizontal inside just above the extrusion */}
      <DimLine
        start={[IW / 2 - EXT_W, floorY + EXT_H + 1.5, 0]}
        end={[  IW / 2,         floorY + EXT_H + 1.5, 0]}
        label="9 in"
      />

      {/* Extrusion height — 10 in, vertical inside left of extrusion */}
      <DimLine
        start={[IW / 2 - EXT_W - 2, floorY,         0]}
        end={[  IW / 2 - EXT_W - 2, floorY + EXT_H, 0]}
        label="10 in"
      />
    </group>
  )
}

// ── FreezerLid ────────────────────────────────────────────────────────────────
interface FreezerLidProps {
  lidGroupRef: React.RefObject<THREE.Group | null>
  onLidClick: (e: ThreeEvent<MouseEvent>) => void
  setHovered: (h: boolean) => void
}

function FreezerLid({ lidGroupRef, onLidClick, setHovered }: FreezerLidProps) {
  const hW = W * 0.48

  const events: MeshEvents = {
    onClick: onLidClick,
    onPointerOver: (e) => { e.stopPropagation(); setHovered(true) },
    onPointerOut:  ()  => setHovered(false),
  }

  return (
    <group ref={lidGroupRef} position={[0, LG + H, -Ln / 2]}>
      <Box pos={[0, LH / 2, Ln / 2]} size={[W + 0.5, LH, Ln + 0.5]} mat={LID_M} {...events} />
      <Box pos={[0, LH / 2, Ln / 2]} size={[W - WT, LH - WT, Ln - WT]} mat={INNER} shadow={false} {...events} />

      <Cyl pos={[0, LH + 1.9, Ln - 1.8]} rot={[0, 0, Math.PI / 2]} args={[0.65, 0.65, hW, 20]} mat={CHROME} {...events} />

      {([-1, 1] as const).map((sx, i) => (
        <Cyl key={i} pos={[sx * hW / 2, LH + 0.85, Ln - 1.8]} args={[0.5, 0.5, 2.1, 12]} mat={CHROME} {...events} />
      ))}

      {([-W / 2 + 4, W / 2 - 4] as const).map((hx, i) => (
        <Cyl key={i} pos={[hx, 0, 0]} rot={[0, 0, Math.PI / 2]} args={[1.1, 1.1, 2.8, 16]} mat={CHROME} {...events} />
      ))}

      <Box pos={[0, LH * 0.35, Ln - 0.1]} size={[W - 4, 0.6, 0.2]} mat={ACCENT} {...events} />
    </group>
  )
}

// ── Freezer (root) ────────────────────────────────────────────────────────────
interface FreezerProps {
  onLidToggle?: (open: boolean) => void
}

export default function Freezer({ onLidToggle }: FreezerProps) {
  const lidGroupRef   = useRef<THREE.Group>(null)
  const interiorLight = useRef<THREE.PointLight>(null)
  const lidAngleRef   = useRef<number>(LID_MAX)

  const [lidOpen,  setLidOpen]  = useState(true)
  const [hovered,  setHovered]  = useState(false)
  useCursor(hovered)

  useFrame(() => {
    const target = lidOpen ? LID_MAX : 0
    lidAngleRef.current += (target - lidAngleRef.current) * 0.08
    if (lidGroupRef.current)   lidGroupRef.current.rotation.x = lidAngleRef.current
    if (interiorLight.current) {
      interiorLight.current.intensity =
        Math.min(1, Math.abs(lidAngleRef.current / LID_MAX)) * 8
    }
  })

  const handleLidClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    const next = !lidOpen
    setLidOpen(next)
    onLidToggle?.(next)
  }

  return (
    <group>
      <pointLight
        ref={interiorLight}
        color="#e8eeff"
        intensity={0}
        position={[0, LG + WT + IH * 0.75, 0]}
        distance={80}
        decay={0.6}
      />

      <FreezerBody />
      <FreezerLegs />
      <RightExtrusion />
      <IceContainers />
      <Compressor />
      <ControlPanel />
      <Dimensions />
      <StandaloneContainer />
      <SheetMetalPatterns />

      <Box pos={[2.5, LG + H - 2, Ln / 2 + 0.18]} size={[W - 9, 0.8, 0.25]} mat={ACCENT} shadow={false} />

      <FreezerLid
        lidGroupRef={lidGroupRef}
        onLidClick={handleLidClick}
        setHovered={setHovered}
      />
    </group>
  )
}
