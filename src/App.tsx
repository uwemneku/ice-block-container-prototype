import { useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Grid } from '@react-three/drei'
import { ACESFilmicToneMapping, PCFSoftShadowMap } from 'three'
import Freezer from './Freezer.tsx'
import './App.css'

function Ground() {
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[500, 500]} />
        <meshStandardMaterial color="#101020" roughness={0.95} />
      </mesh>
      <Grid
        position={[0, 0.01, 0]}
        infiniteGrid
        cellSize={5}
        cellThickness={0.4}
        cellColor="#1a1c35"
        sectionSize={25}
        sectionThickness={0.8}
        sectionColor="#22264a"
        fadeDistance={220}
        fadeStrength={2.5}
      />
    </>
  )
}

export default function App() {
  const [lidOpen, setLidOpen] = useState(true)
  const [showStatus, setShowStatus] = useState(true)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleLidToggle = (open: boolean) => {
    setLidOpen(open)
    setShowStatus(true)
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setShowStatus(false), 2400)
  }

  return (
    <div className="app">
      <Canvas
        shadows={{ type: PCFSoftShadowMap }}
        camera={{ position: [28, 68, 38], fov: 45, near: 0.1, far: 1000 }}
        gl={{ antialias: true, toneMapping: ACESFilmicToneMapping, toneMappingExposure: 1.2 }}
      >
        <color attach="background" args={['#0f0f1a']} />
        <fogExp2 attach="fog" args={['#0f0f1a', 0.007]} />

        <ambientLight color="#aab0cc" intensity={0.7} />

        <directionalLight
          castShadow
          position={[60, 100, 70]}
          intensity={1.8}
          color="#fff5e0"
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-70}
          shadow-camera-right={70}
          shadow-camera-top={70}
          shadow-camera-bottom={-70}
          shadow-camera-far={300}
          shadow-bias={-0.001}
        />
        <directionalLight position={[-50, 20, -40]} intensity={0.5} color="#5577bb" />

        <OrbitControls
          enableDamping
          dampingFactor={0.07}
          minDistance={25}
          maxDistance={180}
          maxPolarAngle={Math.PI * 0.84}
          target={[0, 13, 0]}
        />

        <Ground />
        <Freezer onLidToggle={handleLidToggle} />
      </Canvas>

      <div className="ui">
        <h1>Deep Freezer Prototype</h1>
        <p>Click lid to open / close &nbsp;·&nbsp; Drag to orbit &nbsp;·&nbsp; Scroll to zoom</p>
      </div>

      <div className="dims">
        Interior width:&nbsp;&nbsp;25 in<br />
        Interior length: 20 in<br />
        Interior depth:&nbsp;&nbsp;27 in
      </div>

      <div className={`status ${showStatus ? 'show' : ''}`}>
        {lidOpen ? 'Lid open' : 'Lid closed'}
      </div>
    </div>
  )
}
