/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE. 
 */
"use strict";

function resolveOverloadImpl(functions, typeArguments, argumentTypes)
{
    for (let func of functions) {
        if (typeArguments.length && typeArguments.length != func.typeParameters.length)
            continue;
        if (argumentTypes.length != func.parameters.length)
            continue;
        let unificationContext = new UnificationContext(func.typeParameters);
        let ok = true;
        for (let i = 0; i < typeArguments.length; ++i) {
            let argument = typeArguments[i];
            let parameter = func.typeParameters[i];
            if (!argument.unify(unificationContext, parameter)) {
                ok = false;
                break;
            }
        }
        if (!ok)
            continue;
        for (let i = 0; i < argumentTypes.length; ++i) {
            if (!argumentTypes[i])
                throw new Error("Null argument type at i = " + i);
            if (!argumentTypes[i].unify(unificationContext, func.parameters[i].type)) {
                ok = false;
                break;
            }
        }
        if (!ok)
            continue;
        if (!unificationContext.verify())
            continue;
        let shouldBuildTypeArguments = !typeArguments.length;
        if (shouldBuildTypeArguments)
            typeArguments = [];
        for (let typeParameter of func.typeParameters) {
            let typeArgument = unificationContext.find(typeParameter);
            if (typeArgument == typeParameter) {
                ok = false;
                break;
            }
            if (shouldBuildTypeArguments)
                typeArguments.push(typeArgument);
        }
        if (!ok)
            continue;
        return {func, unificationContext, typeArguments};
    }
    
    return null;
}
