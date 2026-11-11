# Third-Party Notices

## REasy

The project’s RSZ understanding and related implementation guidance were
informed by the [REasy project](https://github.com/seifhassine/REasy) and its
contributors. REasy is MIT licensed; its copyright and MIT permission notice
are retained in `integrations/reasy/REasy-LICENSE.txt`.
The browser-only `lib/re-mesh-parser.js`, `lib/re-tex-parser.js`, and MDF
texture-slot reader were independently implemented using REasy v0.7.9 format
references at commit `f167af01673b20e401ca04c3adc60f1dc932f1e1`:
`file_handlers/mesh/mesh_file.py`, `file_handlers/mesh/profiles/sf6_profile.py`,
`file_handlers/tex/tex_file.py`, `file_handlers/tex/profiles.py`, and
`file_handlers/mdf/mdf_file.py`. The retained MIT notice covers this reference.
No game shaders/assets or REasy runtime binaries are distributed.

## fflate

`lib/fflate.js` is derived from [fflate](https://github.com/101arrowz/fflate),
by Arjun Barrett, and is licensed under the MIT License:

> MIT License
>
> Copyright (c) 2026 Arjun Barrett
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in
> all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.


## bcdec

`lib/bc7-decoder.js` adapts the BC7 algorithm and partition tables from
[iOrange/bcdec](https://github.com/iOrange/bcdec), `bcdec.h`, choosing the MIT
license (source Git blob `553c3ec5a8b99082956f6b2118d508ae384feb23`). JavaScript
adaptation and browser bounds checks are local changes.
Synthetic golden vectors were generated using the original C decoder.

Copyright (c) 2022 Sergii Kudlai

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Shader conversion research patches

The opt-in research directory `experiments/game-shaders` contains narrow patches
against Naga 30.0.1 (gfx-rs/wgpu) and dxil-spirv commit
`7506dc18ca734575ae008de506ca12a3332f6b1e`. Naga's f32-classification writer
and SPIR-V OpUndef scope-bookkeeping changes, and dxil-spirv's Emscripten
portability change, are local experimental modifications. They are not a
claim of upstream acceptance or game-rendering equivalence.

The MIT license option is used for Naga's patch context. Original license
texts are retained in `experiments/game-shaders/licenses/Naga-MIT.txt` and
`experiments/game-shaders/licenses/dxil-spirv-MIT.txt`. No compiled converters,
linked dependency binaries, or proprietary game shader payloads are included.
Distributing future converter binaries requires their complete linked-dependency
license audit, not just these source-patch notices.
