import type { Address, Hex } from "viem";

type HostedSignerRequest =
  | {
      type: "fluent:signer:request";
      state: string;
      method: "personal_sign";
      address: Address;
      message: string;
    }
  | {
      type: "fluent:signer:request";
      state: string;
      method: "eth_signTypedData_v4";
      address: Address;
      typedData: Record<string, unknown>;
    };

type HostedSignerRequestInput =
  | Omit<Extract<HostedSignerRequest, { method: "personal_sign" }>, "state">
  | Omit<Extract<HostedSignerRequest, { method: "eth_signTypedData_v4" }>, "state">;

type HostedSignerResponse =
  | {
      type: "fluent:signer:ready";
      state: string;
    }
  | {
      type: "fluent:signer:result";
      state: string;
      signature: Hex;
    }
  | {
      type: "fluent:signer:error";
      state: string;
      error: string;
    };

export type FluentHostedSigner = {
  address: Address;
  prepare: () => void;
  signMessage: (message: string) => Promise<Hex>;
  signTypedData: (typedData: Record<string, unknown>) => Promise<Hex>;
  close: () => void;
};

const READY_TIMEOUT_MS = 30_000;
const SIGNATURE_TIMEOUT_MS = 120_000;

export function createFluentHostedSigner(params: {
  address: Address;
  authorizeUrl: string;
}): FluentHostedSigner {
  const authorizeOrigin = new URL(params.authorizeUrl, location.href).origin;
  let signerWindow: Window | null = null;
  let state = "";
  let readyPromise: Promise<void> | null = null;
  let resolveReady: (() => void) | null = null;
  let rejectReady: ((error: Error) => void) | null = null;
  let pending:
    | {
        resolve: (signature: Hex) => void;
        reject: (error: Error) => void;
      }
    | null = null;

  const close = () => {
    signerWindow?.close();
    signerWindow = null;
    readyPromise = null;
    resolveReady = null;
    rejectReady = null;
    pending = null;
  };

  const onMessage = (event: MessageEvent<HostedSignerResponse>) => {
    if (event.origin !== authorizeOrigin || event.source !== signerWindow) return;
    const response = event.data;
    if (!response || response.state !== state) return;

    if (response.type === "fluent:signer:ready") {
      resolveReady?.();
      resolveReady = null;
      rejectReady = null;
      return;
    }

    if (response.type === "fluent:signer:result") {
      pending?.resolve(response.signature);
      pending = null;
      return;
    }

    if (response.type === "fluent:signer:error") {
      const error = new Error(response.error);
      if (pending) {
        pending.reject(error);
      } else {
        rejectReady?.(error);
      }
      pending = null;
      resolveReady = null;
      rejectReady = null;
    }
  };

  addEventListener("message", onMessage);

  const prepare = () => {
    if (signerWindow && readyPromise) return;

    state = crypto.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const url = new URL(params.authorizeUrl, location.href);
    url.searchParams.set("action", "fluent_sign");
    url.searchParams.set("origin", location.origin);
    url.searchParams.set("state", state);

    signerWindow = window.open(
      url.toString(),
      "fluent-connect-signer",
      "popup=yes,width=520,height=720,resizable=yes,scrollbars=yes",
    );
    if (!signerWindow) {
      close();
      throw new Error("Allow popups for this app to sign with Fluent Connect");
    }

    readyPromise = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    void readyPromise.catch(() => {
      // The caller observes this rejection when it requests a signature.
    });
  };

  const requestSignature = async (request: HostedSignerRequestInput) => {
    prepare();
    if (!signerWindow || !readyPromise) {
      throw new Error("Fluent Connect signer window is unavailable");
    }

    try {
      await withTimeout(
        readyPromise,
        READY_TIMEOUT_MS,
        "Fluent Connect signer did not become ready",
      );
      if (signerWindow.closed) throw new Error("Fluent Connect signer window was closed");
      if (pending) throw new Error("Another Fluent signature request is already pending");

      const signature = new Promise<Hex>((resolve, reject) => {
        pending = { resolve, reject };
        signerWindow?.postMessage({ ...request, state }, authorizeOrigin);
      });
      return await withTimeout(
        signature,
        SIGNATURE_TIMEOUT_MS,
        "Fluent Connect signature request timed out",
      );
    } finally {
      close();
    }
  };

  return {
    address: params.address,
    prepare,
    signMessage: (message) =>
      requestSignature({
        type: "fluent:signer:request",
        method: "personal_sign",
        address: params.address,
        message,
      }),
    signTypedData: (typedData) =>
      requestSignature({
        type: "fluent:signer:request",
        method: "eth_signTypedData_v4",
        address: params.address,
        typedData,
      }),
    close: () => {
      removeEventListener("message", onMessage);
      rejectReady?.(new Error("Fluent Connect signer was closed"));
      pending?.reject(new Error("Fluent Connect signer was closed"));
      close();
    },
  };
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
