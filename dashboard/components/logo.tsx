import Image from 'next/image';
import logoImage from '../public/logo.png';

export default function Logo() {
  return (
    <a href="https://hol.org" className="flex items-center gap-2 no-underline hover:no-underline">
      <Image src={logoImage} alt="Hashgraph Online Logo" width={34} height={34} className="h-[34px] w-[34px]" />
      <b className="!text-white font-mono font-semibold text-base">HOL</b>
    </a>
  );
}
