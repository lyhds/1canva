// Merchant-selected square size ladder (2026-09-09); inch labels are nominal.
export const squareSizes = [[61,24],[76,30],[81,32],[91,36],[102,40],[112,44],[122,48],[140,55],[153,60],[183,72]]
  .map(([cm,inches])=>({cm,inches,label:`${cm} x ${cm} cm / ${inches} x ${inches} in`}));
