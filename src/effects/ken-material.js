import * as THREE from 'three';

// Original studio-light lookup, generated once. No external artwork or runtime lights.
function createStudioMatcap() {
  const size=256, pixels=new Uint8Array(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const nx=(x+.5)/size*2-1,ny=(y+.5)/size*2-1;
    const nz=Math.sqrt(Math.max(0,1-nx*nx-ny*ny));
    const diffuse=.26+.62*Math.max(0,-nx*.42+ny*.66+nz*.62);
    const rx=2*nz*nx,ry=2*nz*ny;
    // Broad softbox + restrained strip highlight, blurred for satin rather than chrome.
    const broad=Math.exp(-((rx+.4)**2/.22+(ry-.55)**2/.32));
    const strip=Math.exp(-((rx-.75)**2/.035+(ry-.15)**2/.7));
    const specular=Math.min(1,broad*.7+strip*.4);
    const offset=(y*size+x)*4;
    pixels[offset]=Math.round(Math.min(1,diffuse)*255);
    pixels[offset+1]=Math.round(specular*255);
    pixels[offset+2]=0;pixels[offset+3]=255;
  }
  const texture=new THREE.DataTexture(pixels,size,size,THREE.RGBAFormat);
  texture.minFilter=texture.magFilter=THREE.LinearFilter;texture.needsUpdate=true;
  return texture;
}
export function createKenMaterial(){
  const material=new THREE.MeshMatcapMaterial({matcap:createStudioMatcap(),color:'#ffffff',dithering:true});
  material.onBeforeCompile=shader=>{
    shader.vertexShader=`attribute vec4 nearA; attribute vec4 nearB; varying float kenAO;
      float neighborShade(vec3 p,vec3 n,vec4 neighbor){
        vec3 delta=neighbor.xyz-p; float d2=max(dot(delta,delta),.02);
        return max(0.,dot(n,delta*inversesqrt(d2)))*min(1.,neighbor.w*neighbor.w/d2);
      }\n`+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',`#include <project_vertex>
      vec3 kenPosition=(modelMatrix*instanceMatrix*vec4(transformed,1.)).xyz;
      vec3 kenNormal=normalize(mat3(modelMatrix)*mat3(instanceMatrix)*objectNormal);
      kenAO=clamp(1.-.33*neighborShade(kenPosition,kenNormal,nearA)-.33*neighborShade(kenPosition,kenNormal,nearB),.42,1.);
    `);
    shader.fragmentShader='varying float kenAO;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('vec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;',`
      vec3 outgoingLight = (diffuseColor.rgb*(.22+matcapColor.r*1.45)
        +vec3(.68,.82,1.)*matcapColor.g*.27)*kenAO;
    `);
  };
  material.customProgramCacheKey=()=> 'ken-studio-spheres-v1';
  return material;
}
