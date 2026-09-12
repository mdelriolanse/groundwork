import { createStore } from "../app/lib/store.mjs";
const store=createStore(); store.seed();
const ts=new Date().toISOString();
store.recordFeature("RPP1","rms",0.082,"g","cwru:97.mat",new Date(Date.now()-1000).toISOString());
store.recordFeature("RPP1","rpm",1797,"rpm","cwru:97.mat",new Date(Date.now()-1000).toISOString());
store.recordFeature("RPP1","rms",0.361,"g","cwru:105.mat",ts);
store.recordFeature("RPP1","rpm",1797,"rpm","cwru:105.mat",ts);
const id=store.flag({asset_id:"RPP1",part:"URjoint1",fault:"inner_race",source:"cwru:105.mat",window:"0.0s..2.0s",rpm:1797,rms:0.361,ts});
console.log(JSON.stringify({flag_id:id,asset_id:"RPP1",fault:"inner_race",ts})); store.close();
