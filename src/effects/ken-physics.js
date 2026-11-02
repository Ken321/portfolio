import { Vector3, Quaternion, Euler } from 'three';
export const STEP = 1 / 120;
const RESPONSE_SPEED = 2.3;
const MAX_SPEED = 7 * RESPONSE_SPEED;
const DAMPING = Math.exp(-2.8 * RESPONSE_SPEED * STEP);
const axis = new Vector3(), turn = new Quaternion();

// Small, fixed-step sphere simulation. Rendering geometry does not enter the solver.
export function createPhysics(assets, count) {
  const bodies = [];
  let quietSteps = 0, sleeping = false;
  let pointerX = null, pointerY = null, lastPointerX = null, lastPointerY = null;
  let contactCount = 0;
  const aspect = count <= 18 ? 1.1 : 1.35;
  for (let i = 0; i < count; i++) {
    const angle = i * 2.3999632297;
    const ring = Math.sqrt(i + .5);
    const asset = assets[i % 3];
    const position = new Vector3(Math.cos(angle)*ring*.85*aspect, Math.sin(angle)*ring*.55, Math.sin(i*2.1)*1.1);
    bodies.push({
      position, previousPosition: position.clone(), velocity: position.clone().multiplyScalar(-.35),
      quaternion: new Quaternion().setFromEuler(new Euler(Math.sin(i*1.3)*.55, Math.cos(i*.9)*.65, Math.sin(i*2.4)*.6)),
      angular: new Vector3(Math.sin(i+.4)*.22, Math.cos(i+.8)*.28, Math.sin(i*1.8)*.18),
      radius: asset.radius, inverseMass: 1 / (asset.radius ** 3),
    });
  }
  function solve(iterations) {
    for (let pass = 0; pass < iterations; pass++) {
      let maxOverlap = 0;
      for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) {
        const a=bodies[i], b=bodies[j];
        let dx=b.position.x-a.position.x,dy=b.position.y-a.position.y,dz=b.position.z-a.position.z;
        const limit=a.radius+b.radius;
        const distanceSq=dx*dx+dy*dy+dz*dz;
        if(distanceSq>=limit*limit)continue;
        const distance=Math.sqrt(distanceSq);
        if(distance<1e-8){dx=1;dy=0;dz=0;}else{dx/=distance;dy/=distance;dz/=distance;}
        const overlap=limit-distance;
        maxOverlap=Math.max(maxOverlap,overlap);
        const massSum=a.inverseMass+b.inverseMass;
        const correction=(overlap+.00001)/massSum;
        a.position.x-=dx*correction*a.inverseMass;a.position.y-=dy*correction*a.inverseMass;a.position.z-=dz*correction*a.inverseMass;
        b.position.x+=dx*correction*b.inverseMass;b.position.y+=dy*correction*b.inverseMass;b.position.z+=dz*correction*b.inverseMass;
        if(pass!==0)continue;
        contactCount++;
        const vx=b.velocity.x-a.velocity.x,vy=b.velocity.y-a.velocity.y,vz=b.velocity.z-a.velocity.z;
        const speed=vx*dx+vy*dy+vz*dz;
        if(speed<0){
          const impulse=-1.12*speed/massSum;
          a.velocity.x-=dx*impulse*a.inverseMass;a.velocity.y-=dy*impulse*a.inverseMass;a.velocity.z-=dz*impulse*a.inverseMass;
          b.velocity.x+=dx*impulse*b.inverseMass;b.velocity.y+=dy*impulse*b.inverseMass;b.velocity.z+=dz*impulse*b.inverseMass;
          // A little tangential rolling makes contacts readable, without a mesh solver.
          const rolling = Math.abs(speed) > .15 * RESPONSE_SPEED * RESPONSE_SPEED ? .18 : 0;
          const tx=(dy*vz-dz*vy)*rolling,ty=(dz*vx-dx*vz)*rolling,tz=(dx*vy-dy*vx)*rolling;
          a.angular.x+=tx;a.angular.y+=ty;a.angular.z+=tz;
          b.angular.x+=tx;b.angular.y+=ty;b.angular.z+=tz;
        }
      }
      if(maxOverlap<.0001)break;
    }
  }
  solve(20);
  function step(pointer) {
    // Fixed-step pointer velocity transfers a swipe's direction without event-rate dependence.
    let swipeX=0,swipeY=0;
    if(pointer && lastPointerX!==null){
      swipeX=(pointer.x-lastPointerX)/STEP;swipeY=(pointer.y-lastPointerY)/STEP;
      const speed=Math.hypot(swipeX,swipeY);
      if(speed>12){swipeX*=12/speed;swipeY*=12/speed;}
    }
    lastPointerX=pointer?.x??null;lastPointerY=pointer?.y??null;
    if (pointer ? pointerX === null || Math.hypot(pointer.x-pointerX,pointer.y-pointerY) > .006 : pointerX !== null) {
      sleeping=false;quietSteps=0;
      pointerX=pointer?.x??null;pointerY=pointer?.y??null;
    }
    if(sleeping)return;
    let maxMotion=0,maxSpin=0;
    for(let i=0;i<count;i++){
      const body=bodies[i],p=body.position,v=body.velocity;
      body.previousPosition.copy(p);
      // Strong central attraction; no perpetual orbit or time-driven spin.
      // A deeper cluster overlaps in projection without shrinking collision spheres.
      let ax=-p.x*3, ay=-p.y*4, az=-p.z*1.5;
      if(pointer){
        // Project the cursor ray onto this body's depth, not only the z=0 plane.
        const perspective=pointer.cameraZ ? (pointer.cameraZ-p.z)/pointer.cameraZ : 1;
        let dx=p.x-pointer.x*perspective,dy=p.y-pointer.y*perspective;
        const d=Math.hypot(dx,dy),range=body.radius+.8;
        if(d<range){
          if(d<.001){dx=Math.cos(i*2.39996);dy=Math.sin(i*2.39996);}
          const inverse=d<.001?1:1/d;
          const falloff=1-d/range,force=95*falloff;
          ax+=dx*inverse*force+swipeX*18*falloff;ay+=dy*inverse*force+swipeY*18*falloff;
          body.angular.x+=(dy*inverse*12+swipeY*5)*falloff*STEP;
          body.angular.y-=(dx*inverse*12+swipeX*5)*falloff*STEP;
          body.angular.z+=(dx*inverse*swipeY-dy*inverse*swipeX)*falloff*STEP*4;
        }
      }
      // Scale acceleration and damping together for a faster excursion and return.
      const responseStep=STEP*RESPONSE_SPEED*RESPONSE_SPEED;
      v.x=(v.x+ax*responseStep)*DAMPING;v.y=(v.y+ay*responseStep)*DAMPING;v.z=(v.z+az*responseStep)*DAMPING;
      const speed=v.length();if(speed>MAX_SPEED)v.multiplyScalar(MAX_SPEED/speed);
      p.addScaledVector(v,STEP);
      const spin=body.angular;
      spin.multiplyScalar(Math.exp(-STEP*3.5));
      if(spin.lengthSq()>36)spin.setLength(6);
      maxSpin=Math.max(maxSpin,spin.length());
      const angularSpeed=spin.length();
      if(angularSpeed>1e-8){axis.copy(spin).multiplyScalar(1/angularSpeed);turn.setFromAxisAngle(axis,Math.min(angularSpeed,6)*STEP);body.quaternion.premultiply(turn).normalize();}
    }
    // Positional corrections follow integration, unlike the one-pass reference.
    solve(10);
    for(const body of bodies)maxMotion=Math.max(maxMotion,body.position.distanceToSquared(body.previousPosition));
    // Keep the rest threshold relative to the faster simulation response.
    if(maxMotion<1e-6*RESPONSE_SPEED*RESPONSE_SPEED && maxSpin<.03)quietSteps++;else quietSteps=0;
    if(quietSteps>=90){sleeping=true;for(const body of bodies){body.velocity.set(0,0,0);body.angular.set(0,0,0);}}

  }
  return {bodies,step,get sleeping(){return sleeping;},get contactCount(){return contactCount;}};
}
