import { createStore } from "../app/lib/store.mjs";
const store=createStore(); store.seed();
const ts=new Date().toISOString();
store.recordFeature("MTR07-CAD","rms",0.102329,"g","mendeley:0Nm_Normal__ch0.mat",new Date(Date.now()-1000).toISOString());
store.recordFeature("MTR07-CAD","rpm",3010,"rpm","mendeley:0Nm_Normal__ch0.mat",new Date(Date.now()-1000).toISOString());
store.recordFeature("MTR07-CAD","rms",1.352395,"g","mendeley:0Nm_BPFI_10__ch0.mat",ts);
store.recordFeature("MTR07-CAD","rpm",3010,"rpm","mendeley:0Nm_BPFI_10__ch0.mat",ts);
const id=store.flag({asset_id:"MTR07-CAD",part:"1LE1003-1EB23-4JA4",fault:"inner_race",source:"mendeley:0Nm_BPFI_10__ch0.mat",window:"0.00..2.00",rpm:3010,rms:1.352395,ts});
console.log(JSON.stringify({flag_id:id,asset_id:"MTR07-CAD",fault:"inner_race",ts})); store.close();
