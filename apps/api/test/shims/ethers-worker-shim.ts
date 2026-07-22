/**
 * TEST/WORKER-PIPELINE SHIM ONLY — not used in production.
 *
 * The Uniswap v3/v4 SDK barrels import `ethers@5` (`ethers`, `ethers/lib/utils`,
 * `@ethersproject/{abi,address,solidity,abstract-signer}`). The workers test
 * pipeline (vitest-pool-workers → vite-node → workerd) cannot load that package
 * family: its ESM build has extensionless relative imports AND circular named
 * exports (`ethers/lib.esm` ↔ `./ethers`), and its CJS build trips the cjs-shim
 * interop on nested bare requires (`elliptic`).
 *
 * vitest.config.ts aliases those bare specifiers to THIS module, which
 * re-implements only the surface the SDKs actually touch, backed by viem
 * (worker-safe, no circular deps). TypeScript still type-checks against the
 * real packages (the alias is runtime-only), and the production wrangler
 * build bundles the real ethers without issue.
 */

import {
  encodeAbiParameters,
  encodePacked,
  getContractAddress,
  type Hex,
  getAddress as viemGetAddress,
  isAddress as viemIsAddress,
  keccak256 as viemKeccak256,
} from "viem"

const toParamList = (types: readonly string[]) => types.map((type) => ({ type }))

export const defaultAbiCoder = {
  encode: (types: readonly string[], values: readonly unknown[]): Hex =>
    encodeAbiParameters(toParamList(types), values as never),
  decode: (_types: readonly string[], _data: Hex): readonly unknown[] => {
    throw new Error("ethers-worker-shim: AbiCoder.decode is not supported in the test shim")
  },
}

export function isAddress(address: string): boolean {
  return viemIsAddress(address)
}

export function getAddress(address: string): string {
  return viemGetAddress(address)
}

export function keccak256(types: readonly string[], values: readonly unknown[]): Hex {
  return viemKeccak256(encodeAbiParameters(toParamList(types), values as never))
}

export function pack(types: readonly string[], values: readonly unknown[]): Hex {
  return encodePacked(types as never, values as never)
}

export function getCreate2Address(from: string, salt: string, initCodeHash: string): string {
  return getContractAddress({
    opcode: "CREATE2",
    from: from as `0x${string}`,
    salt: salt as `0x${string}`,
    bytecodeHash: initCodeHash as `0x${string}`,
  })
}

export class BigNumber {
  readonly value: bigint
  private constructor(value: bigint) {
    this.value = value
  }
  static from(value: BigNumber | bigint | number | string): BigNumber {
    if (value instanceof BigNumber) return value
    return new BigNumber(BigInt(value))
  }
  eq(other: BigNumber | bigint | number | string): boolean {
    return this.value === BigNumber.from(other).value
  }
  toString(): string {
    return this.value.toString()
  }
}

export const constants = {
  AddressZero: "0x0000000000000000000000000000000000000000",
  HashZero: "0x0000000000000000000000000000000000000000000000000000000000000000",
  Zero: BigNumber.from(0),
  One: BigNumber.from(1),
  Two: BigNumber.from(2),
  NegativeOne: BigNumber.from(-1),
  WeiPerEther: BigNumber.from(10n ** 18n),
  MaxUint256: BigNumber.from(2n ** 256n - 1n),
}

export class Interface {
  encodeFunctionData(): Hex {
    throw new Error("ethers-worker-shim: Interface.encodeFunctionData is not supported in the test shim")
  }
  encodeFunctionResult(): Hex {
    throw new Error("ethers-worker-shim: Interface.encodeFunctionResult is not supported in the test shim")
  }
  decodeFunctionResult(): readonly unknown[] {
    throw new Error("ethers-worker-shim: Interface.decodeFunctionResult is not supported in the test shim")
  }
  getSighash(): Hex {
    throw new Error("ethers-worker-shim: Interface.getSighash is not supported in the test shim")
  }
}

export class TypedDataDomain {}
export class TypedDataField {}

export const utils = {
  defaultAbiCoder,
  isAddress,
  keccak256,
  pack,
  solidityPack: pack,
  solidityKeccak256: keccak256,
  getCreate2Address,
}

export const ethers = {
  utils,
  constants,
  BigNumber,
  Interface,
}
