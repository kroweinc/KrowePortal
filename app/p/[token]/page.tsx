import Link from "next/link";
import type { Metadata } from "next";
import { getBuilderProfileByToken } from "@/lib/actions/builder-profile-public";
import { PublicProfileView } from "@/components/builder-profile/public-profile-view";

interface Props {
  params: Promise<{ token: string }>;
}

// Share links are capability URLs — keep them out of search engines.
export const metadata: Metadata = {
  title: "Profile",
  robots: { index: false, follow: false },
};

export default async function PublicBuilderProfilePage({ params }: Props) {
  const { token } = await params;

  if (!/^[a-f0-9]{64}$/.test(token)) {
    return <ErrorCard message="This profile link is invalid." />;
  }

  // getBuilderProfileByToken already hides unpublished profiles (returns null).
  const data = await getBuilderProfileByToken(token);
  if (!data) {
    return <ErrorCard message="This profile isn't available." />;
  }

  return <PublicProfileView data={data} token={token} />;
}

function ErrorCard({ message }: { message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-sm text-center">
        <p className="text-sm text-neutral-500">{message}</p>
        <Link href="/" className="mt-4 inline-block text-sm text-neutral-700 underline">
          Go home
        </Link>
      </div>
    </main>
  );
}
