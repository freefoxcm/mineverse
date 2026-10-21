import * as THREE from 'three';
import type { Player } from '../player/player';

const SKIN = 0xc98b68;
const HAIR = 0x3b2a1c;
const SHIRT = 0x2f8f99;
const PANTS = 0x35468f;
const SHOES = 0x363636;
const EYE = 0x1a1a1a;

/**
 * Blocky third-person player model (F5). Built from boxes with a simple skin
 * palette so the player can see themselves without needing a skin texture atlas.
 */
export class PlayerModel {
  readonly group = new THREE.Group();
  private readonly head: THREE.Group;
  private readonly armLeft: THREE.Group;
  private readonly armRight: THREE.Group;
  private readonly legLeft: THREE.Group;
  private readonly legRight: THREE.Group;
  private walkPhase = 0;
  private readonly materials: THREE.Material[] = [];

  constructor(scene: THREE.Scene) {
    const makeMaterial = (color: number): THREE.MeshBasicMaterial => {
      const material = new THREE.MeshBasicMaterial({ color });
      this.materials.push(material);
      return material;
    };
    const skin = makeMaterial(SKIN);
    const hair = makeMaterial(HAIR);
    const shirt = makeMaterial(SHIRT);
    const pants = makeMaterial(PANTS);
    const shoes = makeMaterial(SHOES);
    const eye = makeMaterial(EYE);

    this.group.scale.setScalar(0.9);
    this.group.visible = false;

    // Legs (pivot at hip).
    this.legLeft = this.makeLimb(-0.13, 0.75, 0.25, 0.75, 0.25, pants, shoes);
    this.legRight = this.makeLimb(0.13, 0.75, 0.25, 0.75, 0.25, pants, shoes);
    this.group.add(this.legLeft, this.legRight);

    // Torso.
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.75, 0.25), shirt);
    torso.position.set(0, 1.1, 0);
    this.group.add(torso);

    // Arms (pivot at shoulder).
    this.armLeft = this.makeArm(-0.375, 1.42, skin, shirt);
    this.armRight = this.makeArm(0.375, 1.42, skin, shirt);
    this.group.add(this.armLeft, this.armRight);

    // Head + hair + face.
    this.head = new THREE.Group();
    this.head.position.set(0, 1.48, 0);
    const headMesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), skin);
    headMesh.position.set(0, 0.25, 0);
    const hairTop = new THREE.Mesh(new THREE.BoxGeometry(0.53, 0.12, 0.53), hair);
    hairTop.position.set(0, 0.47, 0);
    const hairBack = new THREE.Mesh(new THREE.BoxGeometry(0.53, 0.4, 0.08), hair);
    hairBack.position.set(0, 0.28, 0.245);
    const eyeLeft = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.02), eye);
    eyeLeft.position.set(-0.11, 0.31, -0.256);
    const eyeRight = eyeLeft.clone();
    eyeRight.position.x = 0.11;
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 0.02), eye);
    mouth.position.set(0, 0.13, -0.256);
    this.head.add(headMesh, hairTop, hairBack, eyeLeft, eyeRight, mouth);
    this.group.add(this.head);

    scene.add(this.group);
  }

  private makeLimb(
    x: number,
    pivotY: number,
    width: number,
    height: number,
    depth: number,
    material: THREE.Material,
    shoeMaterial: THREE.Material,
  ): THREE.Group {
    const pivot = new THREE.Group();
    pivot.position.set(x, pivotY, 0);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.y = -height / 2;
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(width + 0.01, 0.16, depth + 0.02), shoeMaterial);
    shoe.position.y = -height + 0.08;
    pivot.add(mesh, shoe);
    return pivot;
  }

  private makeArm(x: number, pivotY: number, skinMaterial: THREE.Material, sleeveMaterial: THREE.Material): THREE.Group {
    const pivot = new THREE.Group();
    pivot.position.set(x, pivotY, 0);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.72, 0.22), skinMaterial);
    arm.position.y = -0.36;
    const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.26, 0.24), sleeveMaterial);
    sleeve.position.y = -0.12;
    pivot.add(arm, sleeve);
    return pivot;
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  update(delta: number, player: Player, thirdPerson: boolean): void {
    this.group.visible = thirdPerson;
    if (!thirdPerson) return;
    this.group.position.set(player.position.x, player.position.y, player.position.z);
    this.group.rotation.y = player.yaw;

    const speed = Math.hypot(player.velocity.x, player.velocity.z);
    this.walkPhase += delta * (2.4 + speed * 1.4);
    const swing = Math.sin(this.walkPhase * 2.2) * Math.min(0.9, speed * 0.16);
    const airborne = !player.onGround;
    this.armLeft.rotation.x = airborne ? -0.6 : swing;
    this.armRight.rotation.x = airborne ? -0.6 : -swing;
    this.legLeft.rotation.x = airborne ? 0.2 : -swing;
    this.legRight.rotation.x = airborne ? 0.2 : swing;
    this.head.rotation.x = player.pitch * 0.75;

    const crouch = player.sneaking ? 0.12 : 0;
    this.group.position.y -= crouch;
    this.head.position.y = 1.48 - crouch * 0.6;
  }

  dispose(): void {
    this.group.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
    for (const material of this.materials) material.dispose();
    this.group.removeFromParent();
  }
}
