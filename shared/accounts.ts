export type BackendAccountRole='member'|'merchant';
export type BackendAccount={id:string;role:BackendAccountRole;displayName:string;address:string;chainId:number;network:'anvil'|'sepolia';status:'active'|'disabled';createdAt:string;updatedAt:string};
