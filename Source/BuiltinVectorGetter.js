/*
 * Copyright 2018 Apple Inc.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 *    1. Redistributions of source code must retain the above copyright notice,
 *       this list of conditions and the following disclaimer.
 *
 *    2. Redistributions in binary form must reproduce the above copyright notice,
 *       this list of conditions and the following disclaimer in the documentation
 *       and/or other materials provided with the distribution.
 *
 *    3. Neither the name of the copyright holder nor the names of its
 *       contributors may be used to endorse or promote products derived from this
 *       software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

import { EPtr } from "./EPtr.js";
import { VectorElementSizes, VectorElementTypes } from "./StandardLibrary.js";

export default class BuiltinVectorGetter {
    constructor(baseTypeName, size, elementName, index)
    {
        this._baseTypeName = baseTypeName;
        this._size = size;
        this._elementName = elementName;
        this._index = index;
    }

    get baseTypeName() { return this._baseTypeName; }
    get size() { return this._size; }
    get elementName() { return this._elementName; }
    get index() { return this._index; }

    toString()
    {
        return `native ${this.baseTypeName} operator.${this.elementName}(${this.baseTypeName}${this.size})`;
    }

    static functions()
    {
        if (!this._functions) {
            this._functions = [];

            const elements = [ "x", "y", "z", "w" ];

            for (let typeName of VectorElementTypes) {
                for (let size of VectorElementSizes) {
                    for (let i = 0; i < size; i++)
                        this._functions.push(new BuiltinVectorGetter(typeName, size, elements[i], i));
                }
            }
        }
        return this._functions;
    }

    instantiateImplementation(func)
    {
        func.implementation = ([vec]) => {
            return EPtr.box(vec.get(this.index));
        };
        func.implementationData = this;
    }
}
export { BuiltinVectorGetter };
