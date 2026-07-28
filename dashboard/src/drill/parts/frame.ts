// Conversions between the CAD frame the drill was measured in and the render
// frame. Extruding a shape and rotating it upright maps the shape's +Y onto
// world -Z, so a CAD azimuth becomes (cos, 0, -sin) and every builder has to
// use the same convention or the pinion lands opposite its window.
import * as THREE from 'three';

const MM = 0.001;

/** CAD z of the render origin, the barrel base ring. */
export const CAD_ORIGIN_Z_MM = 10;

/** CAD z of the hopper's top face, where the drill's lowest face seats. */
export const HOPPER_CAD_OFFSET_MM = 226.2;

/** Drill-frame Y, in meters, for a CAD z in millimeters. */
export const fromCadZ = (zMm: number): number => (zMm - CAD_ORIGIN_Z_MM) * MM;

/** Drill-frame Y for a CAD z taken from Container.stl. */
export const hopperY = (zMm: number): number => (zMm - HOPPER_CAD_OFFSET_MM) * MM;

/** Radial unit vector in the render frame for a CAD azimuth. */
export const cadDir = (deg: number): THREE.Vector3 => {
  const a = THREE.MathUtils.degToRad(deg);
  return new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
};

/** three's LatheGeometry sweeps (sin phi, cos phi), so phi leads the CAD angle by 90 deg. */
export const lathePhi = (deg: number): number => THREE.MathUtils.degToRad(deg + 90);
