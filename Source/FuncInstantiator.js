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

class FuncInstantiator {
    constructor()
    {
        this._instances = new Map();
    }
    
    // Returns a Func object that uniquely identifies a particular system of type arguments.
    getUnique(func, typeArguments)
    {
        if (!func.typeParameters.length)
            return func;
        
        let instances = this._instances.get(func);
        if (!instances)
            this._instances.set(func, instances = []);
        
        for (let instance of instances) {
            let ok = true;
            for (let i = instance.typeArguments.length; i--;) {
                if (!instance.typeArguments[i].equals(typeArguments[i])) {
                    ok = false;
                    break;
                }
            }
            if (!ok)
                continue;
            return instance.func;
        }
        
        let substitution = Substitution.mapping(func.typeParameters, typeArguments);
        
        class Instantiate {
            visitFuncDef(func)
            {
                return new FuncDef(
                    func.origin, func.name,
                    func.returnType.visit(substitution),
                    [], // We're instantiated so we no longer take type parameters.
                    func.parameters.map(parameter => parameter.visit(substitution)),
                    func.body.visit(substitution));
            }
            
            visitNativeFunc(func)
            {
                return new NativeFuncInstance(
                    func,
                    func.returnType.visit(substitution),
                    func.parameters.map(parameter => parameter.visit(substitution)));
            }
        }
        let resultingFunc = func.visit(new Instantiate());
        let instance = {func: resultingFunc, typeArguments};
        instances.push(instance);
        return resultingFunc;
    }
}
