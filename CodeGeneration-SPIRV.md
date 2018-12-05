Notes on converting WHLSL to SPIR-V (for Vulkan)
------------------------------------------------

The SPIR-V code generator lives in [Source/spirv](Source/spirv). It's
nowhere near complete at the moment. The goal is for it to be able
to translate a WHLSL program into binary SPIR-V or the textual
assembly format.

This document contains the information on how the SPIR-V is generated.

## Notes

- In WHLSL, entry points can have return values and parameters. The
  SPIR-V accepted by Vulkan requires entry points to have no return
  values and no parameters. Instead, everything is passed in or out
  via global variables. So WHLSL values/params will be flattened
  into the global variables.

- For now, the WHLSL semantics for attribute(N) maps to GLSL location=N.
  The WHLSL semantic SV_Position maps to SPIR-V Output Location.

- There has been no effort at optimising the SPIR-V e.g. for built-in
  types. A WHLSL cast to float4 uses a standard library function that
  is copied into the output SPIR-V.

## Sample Files

In [Misc](Misc) there is a _simple_ vertex and fragment shader in WHLSL,
along with the SPIR-V form generated by the official tools.
This involved writing GLSL Version 4.5 sources that correspond to the
WHLSL translation rules, and using glslang to compile them into SPIR-V.

```bash
prompt> glslangValidator -H -V -o simple-vert.spv simple.vert
prompt> glslangValidator -H -V -o simple-frag.spv simple.frag
```

Then the disassembly output came from SPIRV-Tools:

```bash
prompt> spirv-dis -o simple-vert.txt simple-vert.spv
prompt> spirv-dis -o simple-frag.txt simple-frag.spv
```

That gives us some hopefully valid SPIR-V to compare against.

## Tools

- [glslang](https://github.com/KhronosGroup/glslang) - for compiling a GLSL file into SPIR-V (useful to see what SPIR-V should look like)
- [SPIRV-Tools](https://github.com/KhronosGroup/SPIRV-Tools) - for validating and disassembling a SPIR-V file
- [SPIRV-Headers](https://github.com/KhronosGroup/SPIRV-Headers) - needed for the other tools
- [SPIRV-Cross](https://github.com/KhronosGroup/SPIRV-Cross) - if you want to translate the SPIR-V back into a human-reable format
