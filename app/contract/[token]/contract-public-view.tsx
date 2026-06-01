import { ContractView } from "@/components/contract/contract-view";
import { DocSignPanel, DocSignedBanner } from "@/components/doc/doc-sign-panel";
import { signContract, type PublicContract } from "@/lib/actions/contracts-public";

export function ContractPublicView({ data }: { data: PublicContract }) {
  const { contract, builderName } = data;
  const isSigned = contract.status === "signed";

  return (
    <main className="min-h-screen bg-neutral-50 py-10 px-4">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-6">
          <p className="text-xs uppercase tracking-wide text-neutral-400">Services Agreement</p>
          <h1 className="mt-1 text-2xl font-semibold text-neutral-900">{contract.title}</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Prepared by <span className="font-medium text-neutral-700">{builderName}</span>
          </p>
        </header>

        <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
          <ContractView content={contract.content} />
        </div>

        {isSigned ? (
          <DocSignedBanner
            message="This contract has been signed."
            signerName={contract.signed_by_name}
            signedAt={contract.signed_at}
          />
        ) : (
          <DocSignPanel
            token={contract.token}
            builderName={builderName}
            action={signContract}
            heading="Accept &amp; sign this contract"
            consentText="I agree to the terms in this agreement, and consent to sign electronically. This signature executes the agreement with"
            buttonLabel="Sign contract"
          />
        )}

        <p className="mt-6 text-center text-xs text-neutral-400">Powered by Krowe Portal</p>
      </div>
    </main>
  );
}
