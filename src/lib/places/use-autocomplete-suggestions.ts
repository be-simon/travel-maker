'use client'

import { useEffect, useRef, useState } from 'react'
import { useMapsLibrary } from '@vis.gl/react-google-maps'

export interface UseAutocompleteSuggestionsReturn {
  suggestions: google.maps.places.AutocompleteSuggestion[]
  isLoading: boolean
  resetSession: () => void
}

export function useAutocompleteSuggestions(
  inputString: string,
  requestOptions: Partial<google.maps.places.AutocompleteRequest> = {}
): UseAutocompleteSuggestionsReturn {
  const placesLib = useMapsLibrary('places')
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null)
  const [suggestions, setSuggestions] = useState<google.maps.places.AutocompleteSuggestion[]>([])
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!placesLib) return
    const { AutocompleteSessionToken, AutocompleteSuggestion } = placesLib

    if (!sessionTokenRef.current) {
      sessionTokenRef.current = new AutocompleteSessionToken()
    }

    if (inputString === '') {
      // Clearing suggestions when the input is empty; same pattern already
      // used elsewhere in this codebase (see add-spot-dialog.tsx's reset
      // effect).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSuggestions([])
      return
    }

    const request: google.maps.places.AutocompleteRequest = {
      ...requestOptions,
      input: inputString,
      sessionToken: sessionTokenRef.current,
    }

    setIsLoading(true)
    AutocompleteSuggestion.fetchAutocompleteSuggestions(request).then((res) => {
      setSuggestions(res.suggestions)
      setIsLoading(false)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placesLib, inputString])

  return {
    suggestions,
    isLoading,
    resetSession: () => {
      sessionTokenRef.current = null
      setSuggestions([])
    },
  }
}
